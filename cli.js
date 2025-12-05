const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// Load from local .env first, then server .env
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

async function checkApiKey() {
    if (!process.env.GEMINI_API_KEY) {
        console.log('\n⚠️  Gemini API Key not found.');
        const { apiKey } = await inquirer.prompt([
            { type: 'password', name: 'apiKey', message: 'Enter your Google Gemini API Key (hidden):', mask: '*' }
        ]);
        if (apiKey) {
            process.env.GEMINI_API_KEY = apiKey;
            // Try to save it for next time
            try {
                fs.writeFileSync(path.join(__dirname, '.env'), `GEMINI_API_KEY=${apiKey}\n`);
                console.log('✅ API Key saved to internal-app/.env');
            } catch (e) {
                console.log('ℹ️  Could not save .env file (likely ignored), but using key for this session.');
            }
        }
    }
}

// Import Identifier Service (Keep this external as it's simple)
    // If this fails, we'll fallback to text-only, but it should work if file exists
    let identifyItem = null;
    let analyzeData = null; // We will load this from services/scraper

    try {
        const idService = require('./services/identifier');
        identifyItem = idService.identifyItem;
        
        // Import advanced analysis from the scraper service
        const scraperService = require('./services/scraper');
        analyzeData = scraperService.analyzeData;
    } catch (e) {
        console.warn("⚠️ Warning: Could not load services. Image search or advanced stats may be disabled.", e.message);
        // Fallback simple analysis if service fails
        analyzeData = (listings) => {
            let prices = listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
            const mean = prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : 0;
            const median = prices.length ? prices[Math.floor(prices.length / 2)].toFixed(2) : 0;
            return { stats: { price: { mean, median, count: prices.length } }, listings };
        };
    }

puppeteer.use(StealthPlugin());

// ============================================================================
// CONFIG
// ============================================================================
const CONFIG = {
  headless: 'new',        // 'new' for headless, false to see browser
  delayMin: 3000,         // Min delay between pages
  delayMax: 6000,         // Max delay between pages
  maxPages: Infinity,     // No page limit - stop based on dates
  defaultDays: 7,         // Default lookback
  timeout: 60000,         // Page load timeout
  minVolatility: 0.20,    // For arbitrage detection
  maxListings: 30000      // High limit - primarily stop based on date window
};

// ============================================================================
// HELPERS
// ============================================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() {
  return Math.floor(Math.random() * (CONFIG.delayMax - CONFIG.delayMin) + CONFIG.delayMin);
}

// ============================================================================
// DATE PARSING
// ============================================================================
function parseSoldDate(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  const currentYear = now.getFullYear();

  let cleanDate = dateStr.replace(/sold\s*/i, '').replace(/ended\s*/i, '').trim();
  if (!cleanDate) return null;

  if (/today|just now/i.test(cleanDate)) return now.getTime();

  const relMatch = cleanDate.match(/(\d+)\s*(day|days|hour|hours|minute|minutes)\s*ago/i);
  if (relMatch) {
    const d = new Date(now);
    const amount = parseInt(relMatch[1]);
    if (relMatch[2].includes('day')) d.setDate(d.getDate() - amount);
    else if (relMatch[2].includes('hour')) d.setHours(d.getHours() - amount);
    else d.setMinutes(d.getMinutes() - amount);
    return d.getTime();
  }

  cleanDate = cleanDate.replace(/-/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthDayMatch = cleanDate.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:\s+(\d{4}))?$/i);
  
  if (monthDayMatch) {
    const month = monthNames.indexOf(monthDayMatch[1].toLowerCase().substring(0, 3));
    const day = parseInt(monthDayMatch[2]);
    let year = monthDayMatch[3] ? parseInt(monthDayMatch[3]) : currentYear;
    let testDate = new Date(year, month, day);
    
    if (testDate > now) {
      year--;
      testDate = new Date(year, month, day);
    }
    
    // Reject dates more than 90 days old
    const ninetyDaysAgo = now.getTime() - 90 * 24 * 60 * 60 * 1000;
    if (testDate.getTime() < ninetyDaysAgo) {
      return null;
    }
    return testDate.getTime();
  }
  return null;
}

function normalizeCondition(cond) {
  if (!cond) return 'Unknown';
  const lower = cond.toLowerCase().trim();
  if (lower.includes('brand new') || lower === 'new') return 'Brand New';
  if (lower.includes('pre-owned') || lower.includes('pre owned') || lower === 'used') return 'Pre-Owned';
  if (lower.includes('open box')) return 'Open Box';
  if (lower.includes('refurbished')) return 'Refurbished';
  if (lower.includes('parts') || lower.includes('not working')) return 'For Parts';
  return cond;
}

// ============================================================================
// URL BUILDER
// ============================================================================
function buildUrl(searchTerm, page = 1) {
  const params = new URLSearchParams({
    '_nkw': searchTerm,
    '_sacat': '0',
    'LH_Sold': '1',
    'LH_Complete': '1',
    'LH_PrefLoc': '1',
    '_sop': '13',      // Sort by date: newest first
    '_ipg': '60'       // 60 items per page
  });
  if (page > 1) params.set('_pgn', page.toString());
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// ============================================================================
// SCRAPE PAGE (Adapted)
// ============================================================================
async function scrapePage(browser, url, pageNum) {
  const page = await browser.newPage();
  
  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    });

    // process.stdout.write(`\r📥 Page ${pageNum}: Loading...   `);
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    } catch (err) {
      // console.log(`   ⚠️ goto timeout, trying to parse whatever loaded anyway`);
    }

    // Scroll to trigger lazy loads (Important for images)
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 300;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight || totalHeight > 3000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });

    await new Promise(r => setTimeout(r, 1500)); // Wait for renders

    const pageContent = await page.content();
    if (pageContent.includes('Pardon Our Interruption') || pageContent.includes('Checking your browser')) {
      console.log(`\n🚫 Blocked on Page ${pageNum}. Skipping...`);
      await page.close();
      return [];
    }

    const listings = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('ul.srp-results > li.s-card, ul.srp-results > li.s-item');
      
      cards.forEach(card => {
        try {
          const text = card.textContent || '';
          if (text.includes('Shop on eBay') || !text.match(/Sold\s/i)) return;
          
          const soldMatch = text.match(/Sold\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s*\d{4})?)/i);
          let soldDate = soldMatch ? 'Sold ' + soldMatch[1] : '';
          
          // Fallback: Try finding date in a looser way if strict match fails but "Sold" is present
          if (!soldDate && text.match(/Sold/i)) {
             const dateMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4})/i);
             if (dateMatch) {
                 soldDate = 'Sold ' + dateMatch[1];
             }
          }
          
          let title = '';
          const titleMatch = text.match(/Sold\s+\w+\s+\d+,?\s*\d*(.+?)Opens in a new/i);
          if (titleMatch) {
            title = titleMatch[1].replace(/^\d{4}/, '').replace(/^,?\s*/, '').replace(/^New Listing/i, '').trim();
          }
          if (!title || title.length < 5) return;
          
          const priceMatch = text.match(/\$(\d+(?:,\d{3})*\.?\d*)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
          if (!price) return;
          
          let condition = '';
          const condEl = card.querySelector('.SECONDARY_INFO, [class*="subtitle"], [class*="condition"]');
          if (condEl) {
            const condText = condEl.textContent || '';
            if (/pre-owned/i.test(condText)) condition = 'Pre-Owned';
            else if (/open\s*box/i.test(condText)) condition = 'Open Box';
            else if (/refurbished/i.test(condText)) condition = 'Refurbished';
            else if (/for\s*parts|not\s*working/i.test(condText)) condition = 'For Parts';
            else if (/brand\s*new/i.test(condText)) condition = 'Brand New';
            else if (/\bnew\b/i.test(condText)) condition = 'Brand New';
            else if (/\bused\b/i.test(condText)) condition = 'Pre-Owned';
          }
          
          if (!condition) {
            if (/Pre-Owned/i.test(text)) condition = 'Pre-Owned';
            else if (/Open\s*Box/i.test(text)) condition = 'Open Box';
            else if (/Refurbished/i.test(text)) condition = 'Refurbished';
            else if (/For\s*Parts|Not\s*Working/i.test(text)) condition = 'For Parts';
            else if (/Brand\s*New/i.test(text)) condition = 'Brand New';
            else {
              const afterPrice = text.split(/\$\d/).pop() || '';
              if (/\bNew\b/.test(afterPrice) && !/New Listing/i.test(afterPrice)) {
                condition = 'Brand New';
              }
            }
          }
          
          const link = card.querySelector('a[href*="/itm/"]');
          const url = link?.href || '';
          const idMatch = url.match(/\/itm\/(\d+)/);
          const itemId = idMatch ? idMatch[1] : '';

          // Image (Improved extraction)
          let image = '';
          const imgEl = card.querySelector('.s-item__image-img, .s-item__image img, .s-card__image, .su-media__image img');
          if (imgEl) {
             // Prioritize data-defer-load (lazy loaded high res) -> data-src -> src
             image = imgEl.getAttribute('data-defer-load') || 
                     imgEl.getAttribute('data-src') || 
                     imgEl.getAttribute('data-config-src') ||
                     imgEl.src;
             
             if (image && !image.startsWith('data:')) {
               // Convert thumbnails to 500px
               image = image.replace(/s-l\d+\.webp/, 's-l500.webp')
                            .replace(/s-l\d+\.jpg/, 's-l500.jpg');
             }
          }
          
          items.push({ itemId, title: title.slice(0, 100), price, soldDate, condition, url, image });
        } catch (e) {}
      });
      return items;
    });

    await page.close();
    return listings;

  } catch (err) {
    console.log(`\n   ❌ Page Error: ${err.message}`);
    try { await page.close(); } catch(e) {}
    return [];
  }
}

// ============================================================================
// CONCURRENT SCRAPER (Conservative 3-tab mode)
// ============================================================================
async function scrapeConcurrent(browser, searchTerm, days, maxPages, targetCutoff) {
  const CONCURRENT_TABS = 3;
  const CONCURRENT_DELAY = 7000; // Longer delay for concurrent (7s)
  const allListings = [];
  let currentPage = 1;
  let shouldStop = false;
  let consecutiveFailures = 0;

  console.log('🚀 Launching 3 concurrent tabs...\n');

  const scrapeNextBatch = async () => {
    const batch = [];
    const batchStartPage = currentPage;
    
    for (let i = 0; i < CONCURRENT_TABS && currentPage <= maxPages && !shouldStop; i++) {
      batch.push(currentPage);
      currentPage++;
    }

    if (batch.length === 0) return [];

    const results = await Promise.all(
      batch.map(async (pageNum) => {
        try {
          const url = buildUrl(searchTerm, pageNum);
          await sleep(Math.random() * 2000); // Stagger starts
          return await scrapePage(browser, url, pageNum);
        } catch (err) {
          console.error(`❌ Error on page ${pageNum}: ${err.message}`);
          return [];
        }
      })
    );

    // Process results
    for (let i = 0; i < results.length; i++) {
      const listings = results[i];
      const pageNum = batch[i];

      if (listings.length === 0) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          console.log('\n🛑 3 consecutive empty pages - stopping');
          shouldStop = true;
          return allListings;
        }
        continue;
      }
      consecutiveFailures = 0;

      // Parse dates
      listings.forEach(l => { l.soldTimestamp = parseSoldDate(l.soldDate); });

      // Filter by date window
      const recentListings = listings.filter(l => {
        if (!l.soldTimestamp) return true;
        return l.soldTimestamp >= targetCutoff;
      });
      const oldCount = listings.length - recentListings.length;

      // Show progress
      const timestamps = recentListings.map(l => l.soldTimestamp).filter(t => t && t > 0);
      if (timestamps.length) {
        const oldest = Math.min(...timestamps);
        const newest = Math.max(...timestamps);
        console.log(`   📄 Page ${pageNum}: ${new Date(newest).toLocaleDateString()} → ${new Date(oldest).toLocaleDateString()} | ${recentListings.length} kept, ${oldCount} old`);
      } else {
        console.log(`   📄 Page ${pageNum}: ${recentListings.length} kept, ${oldCount} old`);
      }

      allListings.push(...recentListings);

      // Stop conditions
      if (oldCount > listings.length / 2) {
        console.log(`\n🎯 Page ${pageNum}: ${oldCount}/${listings.length} items too old - stopping`);
        shouldStop = true;
        return allListings;
      }

      if (recentListings.length === 0 && listings.length > 0) {
        console.log(`\n🛑 Page ${pageNum}: Entirely outside date window - stopping`);
        shouldStop = true;
        return allListings;
      }
    }

    return allListings;
  };

  try {
    while (currentPage <= maxPages && !shouldStop && allListings.length < CONFIG.maxListings) {
      await scrapeNextBatch();
      if (!shouldStop) {
        console.log(`   ⏳ Batch delay ${CONCURRENT_DELAY/1000}s...\n`);
        await sleep(CONCURRENT_DELAY);
      }
    }
  } catch (err) {
    console.error('Concurrent scraping error:', err.message);
  }

  return allListings;
}

// ============================================================================
// CSV HELPERS
// ============================================================================
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function arrayToCSV(data) {
  if (!data || !data.length) return '';
  const headers = Object.keys(data[0]);
  const rows = [headers.join(',')];
  for (const row of data) {
    rows.push(headers.map(h => escapeCSV(row[h])).join(','));
  }
  return rows.join('\n');
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('\n=======================================');
  console.log('   eBay Market Pulse - Internal CLI    ');
  console.log('=======================================\n');

  // Check for API Key first
  await checkApiKey();

  // 1. Menu
  const { searchType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'searchType',
      message: 'How do you want to search?',
      choices: ['Text Search', identifyItem ? 'Identify from Image' : { name: 'Identify from Image (Unavailable - Check Logs)', disabled: true }]
    }
  ]);

  let searchTerm = '';

  if (searchType.includes('Image')) {
    const { imageSource } = await inquirer.prompt([
      {
        type: 'list',
        name: 'imageSource',
        message: 'Image Source:',
        choices: ['Paste URL', 'Select from Downloads']
      }
    ]);

    let imageInput = null;
    let isUrl = false;

    if (imageSource === 'Paste URL') {
      const { url } = await inquirer.prompt([{ type: 'input', name: 'url', message: 'Enter Image URL:' }]);
      imageInput = url;
      isUrl = true;
    } else {
      const downloadsPath = path.join(os.homedir(), 'Downloads');
      try {
        const files = fs.readdirSync(downloadsPath)
          .map(f => ({ name: f, time: fs.statSync(path.join(downloadsPath, f)).mtime.getTime() }))
          .sort((a, b) => b.time - a.time)
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name))
          .slice(0, 10);

        if (files.length === 0) throw new Error('No images found in Downloads');

        const { selectedFile } = await inquirer.prompt([
          { type: 'list', name: 'selectedFile', message: 'Select an image:', choices: files.map(f => f.name) }
        ]);
        const filePath = path.join(downloadsPath, selectedFile);
        console.log(`Loading ${filePath}...`);
        imageInput = fs.readFileSync(filePath);
        isUrl = false;
      } catch (e) {
        console.error('Error reading downloads:', e.message);
        return;
      }
    }

    console.log('\n🤖 Asking Gemini to identify item...');
    try {
      const result = await identifyItem(imageInput, isUrl);
      console.log(`✅ Identified: "${result.searchTerm}"`);
      
      const { confirmTerm } = await inquirer.prompt([
        { type: 'input', name: 'confirmTerm', message: 'Edit search term or press Enter:', default: result.searchTerm }
      ]);
      searchTerm = confirmTerm;
    } catch (e) {
      console.error('❌ Gemini Failed:', e.message);
      return;
    }
  } else {
    const { query } = await inquirer.prompt([{ type: 'input', name: 'query', message: 'Enter search term:' }]);
    searchTerm = query;
  }

  const { days } = await inquirer.prompt([{ type: 'number', name: 'days', message: 'How many days back?', default: 30 }]);
  const { pageLimit } = await inquirer.prompt([{ 
    type: 'input', 
    name: 'pageLimit', 
    message: 'Max pages to scrape? (leave blank for unlimited):', 
    default: '' 
  }]);
  const { scrapingMode } = await inquirer.prompt([{
    type: 'list',
    name: 'scrapingMode',
    message: 'Scraping mode:',
    choices: [
      { name: 'Sequential (Stable, slower)', value: 'sequential' },
      { name: 'Concurrent (Faster, riskier - 3 tabs)', value: 'concurrent' }
    ],
    default: 'sequential'
  }]);
  
  const maxPages = pageLimit && !isNaN(parseInt(pageLimit)) ? parseInt(pageLimit) : Infinity;
  const targetCutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  console.log(`\n🚀 Starting Scrape for "${searchTerm}" (${days} days${maxPages !== Infinity ? `, max ${maxPages} pages` : ', unlimited pages'})...`);
  console.log(`⚡ Mode: ${scrapingMode === 'concurrent' ? 'Concurrent (3 tabs)' : 'Sequential (1 tab)'}\n`);
  
  // LAUNCH BROWSER
  const executablePath = fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined;

  if (executablePath) console.log('🖥️  Using System Chrome');

  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    executablePath,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', 
      '--disable-accelerated-2d-canvas',
      '--disable-gpu', 
      '--window-size=1920,1080'
    ]
  });

  let allListings = [];

  try {
    // Warmup
    const page = await browser.newPage();
    try { await page.goto('https://www.ebay.com', { waitUntil: 'domcontentloaded', timeout: 10000 }); } catch(e){}
    await page.close();

    if (scrapingMode === 'concurrent') {
      // CONCURRENT MODE: 3 tabs in parallel
      allListings = await scrapeConcurrent(browser, searchTerm, days, maxPages, targetCutoff);
    } else {
      // SEQUENTIAL MODE: Original stable approach
      let consecutiveFailures = 0;

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = buildUrl(searchTerm, pageNum);
        const listings = await scrapePage(browser, url, pageNum);
        
        if (listings.length === 0) {
          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            console.log('\n🛑 3 consecutive empty/failed pages - stopping');
            break;
          }
          continue;
        }
        consecutiveFailures = 0;

        // Parse dates for all listings
        listings.forEach(l => {
          l.soldTimestamp = parseSoldDate(l.soldDate);
        });
        
        // SMART FILTERING: Only keep listings within our date window (matching hell.js)
        const recentListings = listings.filter(l => {
          if (!l.soldTimestamp) return true; // Keep undated (assume recent)
          return l.soldTimestamp >= targetCutoff;
        });
        const oldCount = listings.length - recentListings.length;
        
        // Show date info
        const timestamps = recentListings.map(l => l.soldTimestamp).filter(t => t && t > 0);
        if (timestamps.length) {
          const oldest = Math.min(...timestamps);
          const newest = Math.max(...timestamps);
          console.log(`   📅 ${new Date(newest).toLocaleDateString()} → ${new Date(oldest).toLocaleDateString()}`);
        }
        console.log(`   ✅ ${recentListings.length} recent, ${oldCount} old (filtered out)`);
        
        // Add only recent listings
        allListings.push(...recentListings);
        
        // SMART STOP CONDITIONS (matching hell.js exactly)
        
        // 1. If MORE than half the page is old data, we've gone past our window
        if (oldCount > listings.length / 2) {
          console.log(`\n🎯 Most listings now older than ${days} days - stopping`);
          break;
        }
        
        // 2. If entire page is old, definitely stop
        if (recentListings.length === 0 && listings.length > 0) {
          console.log(`\n🛑 Entire page is outside ${days}-day window - stopping`);
          break;
        }
        
        // 3. Stop if we have plenty of data (high limit)
        if (allListings.length >= CONFIG.maxListings) {
          console.log(`\n📊 Got ${allListings.length} listings - that's enough for analysis!`);
          break;
        }
        
        const delay = randomDelay();
        console.log(`   ⏳ Waiting ${(delay/1000).toFixed(1)}s...\n`);
        await sleep(delay);
      }
    }

  } finally {
    await browser.close();
  }

  // ═══════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log(`📦 COLLECTED: ${allListings.length} listings (within ${days} days)`);

  if (!allListings.length) {
    console.log('❌ No listings found');
    return;
  }

  const timestamps = allListings.map(l => l.soldTimestamp).filter(Boolean).sort((a, b) => a - b);
  if (timestamps.length) {
    const actualDays = Math.ceil((timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24));
    console.log(`   📅 ${new Date(timestamps[0]).toLocaleDateString()} → ${new Date(timestamps[timestamps.length-1]).toLocaleDateString()} (${actualDays} days)`);
  }
  console.log('═'.repeat(60) + '\n');

  // EXPORT
  console.log('✅ Scraping Complete!');
  
  // Use advanced analysis
  const results = analyzeData(allListings, searchTerm, days);
  const priceStats = results.stats.price || { count: 0, mean: 0, median: 0 };

  console.log(`Total Items: ${priceStats.count}`);
  console.log(`Avg Price: $${priceStats.mean} | Median: $${priceStats.median}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${searchTerm.replace(/[^a-z0-9]/gi, '_')}-${timestamp}`;
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  // Save Full JSON (includes trends, groups, everything)
  fs.writeFileSync(path.join(outputDir, `${filename}.json`), JSON.stringify(results, null, 2));
  
  // Save Listings CSV
  if (allListings.length > 0) {
      const csv = arrayToCSV(allListings.map(l => ({
          title: l.title,
          price: l.price,
          date: l.soldDate,
          condition: l.condition,
          link: l.url,
          image: l.image
      })));
      fs.writeFileSync(path.join(outputDir, `${filename}-listings.csv`), csv);
      console.log(`\n📂 Saved listings to internal-app/output/${filename}-listings.csv`);
  }

  // Save Market Cheat Sheet (Groups) CSV
  if (results.opportunities && results.opportunities.groups && results.opportunities.groups.length > 0) {
      const groupsCsv = arrayToCSV(results.opportunities.groups.map(g => ({
          group: g.group,
          sold: g.sold,
          avgPrice: g.avgPrice,
          medianPrice: g.medianPrice,
          minPrice: g.minPrice,
          maxPrice: g.maxPrice,
          priceSpread: g.priceSpread,
          last24h: g.last24h,
          sampleUrl: g.minPriceUrl
      })));
      fs.writeFileSync(path.join(outputDir, `${filename}-groups.csv`), groupsCsv);
      console.log(`📂 Saved groups to internal-app/output/${filename}-groups.csv`);
  }

  // Save N-grams CSV
  if (results.trends && results.trends.ngrams && results.trends.ngrams.length > 0) {
      const ngramsCsv = arrayToCSV(results.trends.ngrams.map(n => ({
          term: n.term,
          sold: n.sold,
          avgPrice: n.avgPrice,
          revenue: n.revenue
      })));
      fs.writeFileSync(path.join(outputDir, `${filename}-ngrams.csv`), ngramsCsv);
      console.log(`📂 Saved keywords to internal-app/output/${filename}-ngrams.csv`);
  }
}

main().catch(console.error);