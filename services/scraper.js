const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// ============================================================================
// CONFIG
// ============================================================================
const CONFIG = {
  headless: 'new',
  delayMin: 1500,   // Slower to avoid CPU spikes
  delayMax: 3000,   
  maxPages: 500,
  defaultDays: 7,
  timeout: 60000,
  maxListings: 30000,
};

// ============================================================================
// HELPERS
// ============================================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() {
  return Math.floor(Math.random() * (CONFIG.delayMax - CONFIG.delayMin) + CONFIG.delayMin);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150); // Slower scroll
    });
  });
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
    '_sop': '13',
    '_ipg': '60'
  });
  if (page > 1) params.set('_pgn', page.toString());
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// ============================================================================
// ANALYSIS LOGIC
// ============================================================================
const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','for','of','with','to','from','by','as','is','it','be','are','was','this','that',
  'new','used','like','great','good','excellent','condition','free','shipping','fast','lot','set','bundle','item','items','sale',
  'buy','now','offer','best','see','pics','please','look','check','my','other','rare','vintage','authentic','genuine','brand',
  'sealed','box','only','included','includes','comes','without','size','color','model','usa','seller','day','same','next'
]);

function filterBulkLots(listings, maxPrice = 1500) {
  const lotPatterns = /\b(lot|bulk|wholesale|(\d+)\s*x\s*|x\s*(\d+)|\d{2,}\s*(pcs|pieces|units)|bundle|batch)\b/i;
  const foreignPatterns = /[\u3000-\u9fff]|schwarz|neu|très|nuevo|nuovo/i;
  return listings.filter(l => {
    if (lotPatterns.test(l.title)) return false;
    if (foreignPatterns.test(l.title)) return false;
    if (l.price && l.price > maxPrice) return false;
    return true;
  });
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1)];
}

function normalizeText(text) {
  return text.toLowerCase();
}

function tokenizeTitle(title) {
  const normalized = title.toLowerCase();
  return normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t && t.length > 1);
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i-1] === a[j-1] 
        ? matrix[i-1][j-1]
        : Math.min(matrix[i-1][j-1] + 1, matrix[i][j-1] + 1, matrix[i-1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function tokensSimilar(a, b, threshold = 0.8) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 3) return false;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 3) return a === b;
  const distance = levenshtein(a, b);
  return (1 - (distance / maxLen)) >= threshold;
}

function tokenSetSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let matches = 0;
  const matchedB = new Set();
  for (const a of setA) {
    if (setB.has(a)) {
      matches++;
      matchedB.add(a);
      continue;
    }
    for (const b of setB) {
      if (matchedB.has(b)) continue;
      if (tokensSimilar(a, b, 0.8)) {
        matches += 0.8;
        matchedB.add(b);
        break;
      }
    }
  }
  const union = setA.size + setB.size - matches;
  return matches / union;
}

function buildTokenStats(listings) {
  const df = {};
  listings.forEach(l => {
    const tokens = new Set(tokenizeTitle(l.title));
    for (const t of tokens) {
      if (STOPWORDS.has(t)) continue;
      df[t] = (df[t] || 0) + 1;
    }
  });
  return df;
}

function buildTitleKey(title, tokenStats, totalDocs) {
  const tokens = tokenizeTitle(title);
  const filtered = tokens.filter(t => {
    if (STOPWORDS.has(t)) return false;
    const df = tokenStats[t] || 0;
    if (df <= 1) return false;
    if (df / totalDocs > 0.6) return false;
    return true;
  });
  const keyTokens = filtered.length ? filtered : tokens.filter(t => !STOPWORDS.has(t)).slice(0, 5);
  keyTokens.sort();
  return keyTokens.join(' ');
}

function buildFuzzyGroups(listings, similarityThreshold = 0.6) {
  // Optimization: If dataset is too large (> 2000 items), skip expensive O(n^2) fuzzy grouping
  if (listings.length > 2000) {
      return []; 
  }

  const groups = [];
  const assigned = new Set();
  const listingTokens = listings.map(l => ({
    listing: l,
    tokens: tokenizeTitle(l.title).filter(t => !STOPWORDS.has(t))
  }));
  
  for (let i = 0; i < listingTokens.length; i++) {
    if (assigned.has(i)) continue;
    const group = [listingTokens[i].listing];
    assigned.add(i);
    for (let j = i + 1; j < listingTokens.length; j++) {
      if (assigned.has(j)) continue;
      const similarity = tokenSetSimilarity(listingTokens[i].tokens, listingTokens[j].tokens);
      if (similarity >= similarityThreshold) {
        group.push(listingTokens[j].listing);
        assigned.add(j);
      }
    }
    if (group.length >= 2) groups.push(group);
    }
  return groups;
}

function analyzePrices(listings) {
  let prices = listings.map(l => l.price).filter(p => p).sort((a, b) => a - b);
  if (!prices.length) return null;
  
  let outliers = 0;
  if (prices.length > 10) {
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const filtered = prices.filter(p => p >= q1 - iqr * 1.5 && p <= q3 + iqr * 1.5);
    outliers = prices.length - filtered.length;
    prices = filtered;
  }
  
  if (!prices.length) return null;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / prices.length;
  
  return {
    count: prices.length, outliers,
    min: prices[0].toFixed(2),
    max: prices[prices.length - 1].toFixed(2),
    mean: mean.toFixed(2),
    median: prices[Math.floor(prices.length / 2)].toFixed(2),
    stdev: Math.sqrt(variance).toFixed(2)
  };
}

function extractNgrams(listings, n = 2) {
  const grams = {};
  listings.forEach(listing => {
    const words = tokenizeTitle(listing.title).filter(w => !STOPWORDS.has(w) && !/^\d+$/.test(w));
    for (let i = 0; i <= words.length - n; i++) {
      const ng = words.slice(i, i + n).join(' ');
      if (!grams[ng]) grams[ng] = { count: 0, totalPrice: 0, prices: [] };
      grams[ng].count++;
      if (listing.price) {
        grams[ng].totalPrice += listing.price;
        grams[ng].prices.push(listing.price);
      }
    }
  });
  return Object.entries(grams).map(([term, data]) => ({
    term,
    sold: data.count,
    avgPrice: data.prices.length ? (data.totalPrice / data.prices.length).toFixed(2) : '0',
    revenue: data.totalPrice.toFixed(2)
  })).sort((a, b) => b.sold - a.sold);
}

function summarizeGroups(listings, daysWindow = 7) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const cutoff = now - daysWindow * oneDayMs;
  const windowListings = filterBulkLots(listings).filter(l => l.soldTimestamp && l.soldTimestamp >= cutoff);
  if (!windowListings.length) return [];

  const fuzzyGroups = buildFuzzyGroups(windowListings, 0.5);
  const tokenStats = buildTokenStats(windowListings);
  const totalDocs = windowListings.length;
  const keyGroups = {};
  
  for (const l of windowListings) {
    const key = buildTitleKey(l.title, tokenStats, totalDocs);
    if (!key) continue;
    if (!keyGroups[key]) keyGroups[key] = [];
    keyGroups[key].push(l);
  }

  const rows = [];
  const processedIds = new Set();
  
  for (const items of fuzzyGroups) {
    if (items.length < 2) continue;
    const prices = items.map(i => i.price).filter(p => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    if (!prices.length) continue;

    const count = prices.length;
    const avg = prices.reduce((a, b) => a + b, 0) / count;
    const median = prices[Math.floor(count / 2)];
    const last24hCount = items.filter(i => i.soldTimestamp && i.soldTimestamp >= now - oneDayMs).length;
    
    const allTokens = items.flatMap(i => tokenizeTitle(i.title).filter(t => !STOPWORDS.has(t)));
    const tokenCounts = {};
    allTokens.forEach(t => tokenCounts[t] = (tokenCounts[t] || 0) + 1);
    const commonTokens = Object.entries(tokenCounts)
      .filter(([_, c]) => c >= items.length * 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);
    commonTokens.sort();
    const groupLabel = commonTokens.join(' ') || items[0].title.slice(0, 40);
    const withUrls = items.filter(i => i.url).sort((a, b) => a.price - b.price);

    rows.push({
      group: groupLabel.slice(0, 60),
      sold: count,
      last24h: last24hCount,
      avgPrice: avg.toFixed(2),
      medianPrice: median.toFixed(2),
      minPrice: prices[0].toFixed(2),
      maxPrice: prices[prices.length - 1].toFixed(2),
      priceSpread: ((prices[prices.length-1] - prices[0]) / avg * 100).toFixed(0) + '%',
      minPriceUrl: withUrls[0]?.url || '',
      maxPriceUrl: withUrls[withUrls.length - 1]?.url || ''
    });
    items.forEach(i => processedIds.add(i.itemId));
  }

  // Always add key-based groups (critical for large datasets)
  for (const [key, items] of Object.entries(keyGroups)) {
    const unprocessed = items.filter(i => !processedIds.has(i.itemId));
    if (unprocessed.length < 2) continue;

    const prices = unprocessed.map(i => i.price).filter(p => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    if (!prices.length) continue;

    const count = prices.length;
    const avg = prices.reduce((a, b) => a + b, 0) / count;
    const median = prices[Math.floor(count / 2)];
    const last24hCount = unprocessed.filter(i => i.soldTimestamp && i.soldTimestamp >= now - oneDayMs).length;

    rows.push({
      group: key.slice(0, 60),
      sold: count,
      last24h: last24hCount,
      avgPrice: avg.toFixed(2),
      medianPrice: median.toFixed(2),
      minPrice: prices[0].toFixed(2),
      maxPrice: prices[prices.length - 1].toFixed(2),
      priceSpread: ((prices[prices.length-1] - prices[0]) / avg * 100).toFixed(0) + '%',
      minPriceUrl: unprocessed.filter(i => i.url).sort((a, b) => a.price - b.price)[0]?.url || '',
      maxPriceUrl: unprocessed.filter(i => i.url).sort((a, b) => b.price - a.price)[0]?.url || ''
    });
  }

  return rows.sort((a, b) => b.sold - a.sold);
}

function findArbitrageOpportunities(listings, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = filterBulkLots(listings).filter(l => l.soldTimestamp && l.soldTimestamp >= cutoff);
  if (!recent.length) return [];

  const groups = buildFuzzyGroups(recent, 0.65);
  const opportunities = [];

  groups.forEach(items => {
    if (items.length < 3) return;
    
    const prices = items.map(i => i.price).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length < 3) return;
    
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const median = prices[Math.floor(prices.length / 2)];
    
    const p10 = percentile(prices, 10);
    const p90 = percentile(prices, 90);
    
    if ((p90 - p10) / median < 0.20) return;
    
    const buyUnder = p10; 
    const sellAt = median; 
    
    if (buyUnder >= sellAt) return;
    
    const profit = sellAt - buyUnder;
    const roi = (profit / buyUnder) * 100;
    
    if (roi < 15 || profit < 10) return;
    
    const allTokens = items.flatMap(i => tokenizeTitle(i.title).filter(t => !STOPWORDS.has(t)));
    const tokenCounts = {};
    allTokens.forEach(t => tokenCounts[t] = (tokenCounts[t] || 0) + 1);
    const commonTokens = Object.entries(tokenCounts)
      .filter(([_, c]) => c >= items.length * 0.6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
    commonTokens.sort();
    
    let groupLabel = commonTokens.join(' ');
    if (groupLabel.length < 5) groupLabel = items[0].title.slice(0, 40);

    const sortedByPrice = items.filter(i => i.url).sort((a, b) => a.price - b.price);
    const dailyVol = items.length / days;

    opportunities.push({
      item: groupLabel.slice(0, 60),
      salesCount: items.length,
      perDay: dailyVol.toFixed(2),
      buyUnder: buyUnder.toFixed(2),
      sellAt: sellAt.toFixed(2),
      profit: profit.toFixed(2),
      roi: roi.toFixed(0) + '%',
      spreadPct: (((p90 - p10) / median) * 100).toFixed(0) + '%',
      lowPriceUrl: sortedByPrice[0]?.url || '',
      highPriceUrl: sortedByPrice[sortedByPrice.length - 1]?.url || ''
    });
  });

  return opportunities.sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit));
}

function analyzeByCondition(listings) {
  const conditions = {};
  listings.forEach(l => {
    const cond = normalizeCondition(l.condition);
    if (!conditions[cond]) conditions[cond] = { count: 0, revenue: 0 };
    conditions[cond].count++;
    if (l.price) conditions[cond].revenue += l.price;
  });
  return Object.entries(conditions).map(([condition, data]) => ({
    condition,
    sold: data.count,
    revenue: data.revenue.toFixed(2),
    avgPrice: data.count ? (data.revenue / data.count).toFixed(2) : '0'
  })).sort((a, b) => b.sold - a.sold);
}

function analyzeVelocity(listings, daysWindow) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const cutoff = now - daysWindow * oneDayMs;
  
  const validListings = listings.filter(l => l.soldTimestamp && l.soldTimestamp >= cutoff);
  if (!validListings.length) return null;
  
  const byDay = {};
  validListings.forEach(l => {
    const day = new Date(l.soldTimestamp).toISOString().split('T')[0];
    if (!byDay[day]) byDay[day] = { count: 0, revenue: 0 };
    byDay[day].count++;
    if (l.price) byDay[day].revenue += l.price;
  });
  
  const days = Object.keys(byDay).sort();
  const totalSales = validListings.length;
  const totalRevenue = validListings.reduce((sum, l) => sum + (l.price || 0), 0);
  const avgPerDay = totalSales / daysWindow;
  const revenuePerDay = totalRevenue / daysWindow;
  const peakDay = days.reduce((best, day) => byDay[day].count > (byDay[best]?.count || 0) ? day : best, days[0]);
  
  let weekendSales = 0, weekdaySales = 0;
  days.forEach(day => {
    const dow = new Date(day).getDay();
    if (dow === 0 || dow === 6) weekendSales += byDay[day].count;
    else weekdaySales += byDay[day].count;
  });
  
  return {
    totalSales,
    totalRevenue: totalRevenue.toFixed(2),
    avgPerDay: avgPerDay.toFixed(1),
    revenuePerDay: revenuePerDay.toFixed(2),
    peakDay,
    peakDaySales: byDay[peakDay]?.count || 0,
    weekendSales,
    weekdaySales,
    dailyBreakdown: days.map(d => ({
      date: d,
      sold: byDay[d].count,
      revenue: byDay[d].revenue.toFixed(2)
    }))
  };
}

function analyzePriceDistribution(listings) {
  const prices = listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 5) return null;
  const buckets = [
    { label: '$0-25', min: 0, max: 25 },
    { label: '$25-50', min: 25, max: 50 },
    { label: '$50-100', min: 50, max: 100 },
    { label: '$100-200', min: 100, max: 200 },
    { label: '$200-500', min: 200, max: 500 },
    { label: '$500+', min: 500, max: Infinity }
  ];
  return buckets.map(b => {
    const inBucket = prices.filter(p => p >= b.min && p < b.max);
    const revenue = inBucket.reduce((sum, p) => sum + p, 0);
    return {
      range: b.label,
      count: inBucket.length,
      pct: ((inBucket.length / prices.length) * 100).toFixed(1) + '%',
      revenue: revenue.toFixed(2),
      avgPrice: inBucket.length ? (revenue / inBucket.length).toFixed(2) : '0'
    };
  }).filter(b => b.count > 0);
}

function analyzeFlipPotential(listings, daysWindow) {
  return findArbitrageOpportunities(listings, daysWindow);
}

function analyzeHotItems(listings, daysWindow) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const recentCutoff = now - (daysWindow / 2) * oneDayMs;
  const tokenStats = buildTokenStats(listings);
  const totalDocs = listings.length;
  const groups = {};
  listings.forEach(l => {
    const key = buildTitleKey(l.title, tokenStats, totalDocs);
    if (!key) return;
    if (!groups[key]) groups[key] = { all: [], recent: [] };
    groups[key].all.push(l);
    if (l.soldTimestamp && l.soldTimestamp >= recentCutoff) {
      groups[key].recent.push(l);
    }
  });
  const hotItems = [];
  Object.entries(groups).forEach(([key, data]) => {
    if (data.all.length < 3) return;
    const allPrices = data.all.map(i => i.price).filter(p => p > 0);
    const recentPrices = data.recent.map(i => i.price).filter(p => p > 0);
    if (!allPrices.length) return;
    const avgAll = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const avgRecent = recentPrices.length ? recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length : avgAll;
    const velocity = data.all.length / daysWindow;
    const recentVelocity = data.recent.length / (daysWindow / 2);
    const velocityTrend = recentVelocity / (velocity || 1);
    const priceTrend = avgRecent / avgAll;
    if (velocityTrend > 1.2 || priceTrend > 1.1) {
      hotItems.push({
        item: key.slice(0, 50),
        totalSales: data.all.length,
        recentSales: data.recent.length,
        perDay: velocity.toFixed(2),
        avgPrice: avgAll.toFixed(2),
        recentAvg: avgRecent.toFixed(2),
        velocityTrend: velocityTrend.toFixed(2) + 'x',
        priceTrend: ((priceTrend - 1) * 100).toFixed(0) + '%',
        signal: velocityTrend > 1.5 ? '🔥🔥' : velocityTrend > 1.2 ? '🔥' : '📈',
        sampleUrl: data.recent[0]?.url || data.all[0]?.url || ''
      });
    }
  });
  return hotItems.sort((a, b) => b.totalSales - a.totalSales);
}

function analyzeBrandPerformance(listings) {
  const brandPatterns = [
    /\b(nike|adidas|puma|reebok|converse|vans|jordans?)\b/i,
    /\b(apple|samsung|sony|lg|google|microsoft)\b/i,
    /\b(gucci|prada|louis\s*vuitton|chanel|hermes|burberry|coach)\b/i,
    /\b(zara|h&m|uniqlo|gap|forever\s*21|urban\s*outfitters|anthropologie)\b/i,
    /\b(levi'?s?|wrangler|lee|diesel|true\s*religion)\b/i,
    /\b(nintendo|playstation|xbox|ps[45])\b/i,
    /\b(north\s*face|patagonia|columbia|arc'?teryx)\b/i,
    /\b(free\s*people|reformation|madewell|aritzia)\b/i
  ];
  const brands = {};
  listings.forEach(l => {
    const title = l.title.toLowerCase();
    for (const pattern of brandPatterns) {
      const match = title.match(pattern);
      if (match) {
        const brand = match[1].toLowerCase().replace(/\s+/g, ' ');
        if (!brands[brand]) brands[brand] = { count: 0, revenue: 0, prices: [] };
        brands[brand].count++;
        if (l.price) {
          brands[brand].revenue += l.price;
          brands[brand].prices.push(l.price);
        }
        break;
      }
    }
  });
  return Object.entries(brands)
    .map(([brand, data]) => ({
      brand: brand.charAt(0).toUpperCase() + brand.slice(1),
      sold: data.count,
      revenue: data.revenue.toFixed(2),
      avgPrice: data.count ? (data.revenue / data.count).toFixed(2) : '0',
      minPrice: data.prices.length ? Math.min(...data.prices).toFixed(2) : '0',
      maxPrice: data.prices.length ? Math.max(...data.prices).toFixed(2) : '0'
    }))
    .filter(b => b.sold >= 2)
    .sort((a, b) => b.sold - a.sold);
}

function analyzeData(allListings, searchTerm, targetDays) {
  console.log('\n📊 Starting Data Analysis... (This may take a moment)');
  const singleItems = filterBulkLots(allListings);
  const priceStats = analyzePrices(singleItems);
  const ngrams2 = extractNgrams(singleItems, 2);
  const ngrams3 = extractNgrams(singleItems, 3);
  const ngrams4 = extractNgrams(singleItems, 4);
  const ngrams5 = extractNgrams(singleItems, 5);
  const ngrams6 = extractNgrams(singleItems, 6);
  const groupSummary = summarizeGroups(allListings, targetDays);
  const arbitrage = findArbitrageOpportunities(allListings, targetDays);
  const conditions = analyzeByCondition(allListings);
  
  let newCount = 0;
  let totalCount = 0;
  conditions.forEach(c => {
    totalCount += c.sold;
    if (c.condition.toLowerCase().includes('new')) {
      newCount += c.sold;
    }
  });
  const newVsUsed = {
    newPct: totalCount ? Math.round((newCount / totalCount) * 100) : 0,
    usedPct: totalCount ? Math.round(((totalCount - newCount) / totalCount) * 100) : 0,
    newCount,
    usedCount: totalCount - newCount
  };

  const velocity = analyzeVelocity(allListings, targetDays);
  const priceBuckets = analyzePriceDistribution(singleItems);
  const flipOpps = analyzeFlipPotential(singleItems, targetDays);
  const hotItems = analyzeHotItems(allListings, targetDays);
  const brands = analyzeBrandPerformance(allListings);
  
  return {
    meta: {
      searchTerm,
      targetDays,
      fetchedAt: new Date().toISOString(),
      totalListings: allListings.length
    },
    stats: {
      price: priceStats,
      velocity,
      conditions,
      newVsUsed,
      priceBuckets
    },
    trends: {
      ngrams: ngrams2.slice(0, 50),
      ngrams3: ngrams3.slice(0, 50),
      ngrams4: ngrams4.slice(0, 50),
      ngrams5: ngrams5.slice(0, 50),
      ngrams6: ngrams6.slice(0, 50),
      hotItems: hotItems.slice(0, 30),
      brands
    },
    opportunities: {
      arbitrage: arbitrage.slice(0, 30),
      flips: flipOpps.slice(0, 30),
      groups: groupSummary
    },
    listings: allListings
  };
}

// ============================================================================
// MAIN EXPORT FUNCTION
// ============================================================================
async function scrapeEbay(searchTerm, options = {}, onProgress = () => {}) {
  const targetDays = options.days || CONFIG.defaultDays;
  const targetCutoff = Date.now() - targetDays * 24 * 60 * 60 * 1000;
  const stopCheck = options.shouldStop || (() => false); 

  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 180000,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage', 
      '--disable-accelerated-2d-canvas', 
      '--disable-gpu', 
      '--window-size=1920,1080',
      '--blink-settings=imagesEnabled=false' 
    ]
  });

  let page = null;
  let context = null;

  const initPage = async () => {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 
    });

    // WARMUP: Visit Homepage first to set session cookies (Crucial for deep pages)
    try {
        await page.goto('https://www.ebay.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(1000);
    } catch (e) { }
  };

  const allListings = [];
  let hasMore = true;
  let pageNum = 1;
  let consecutiveFailures = 0;

  try {
    await initPage();

    if (onProgress) onProgress({ phase: 'STARTING', page: 0, itemsFound: 0 });
    
    // Start loop updates for Partial Results (Slower Interval: 10s)
    const partialInterval = setInterval(() => {
        if (onProgress && allListings.length > 0) {
             try {
                 const partial = analyzeData(allListings, searchTerm, targetDays);
                 onProgress({
                     phase: 'SCRAPING',
                     page: pageNum, 
                     itemsFound: allListings.length,
                     lastItemDate: allListings[allListings.length-1]?.soldDate || 'Updating...',
                     partialResult: partial
                 });
             } catch(e) {}
        }
    }, 10000);

    while (hasMore && pageNum <= CONFIG.maxPages && allListings.length < CONFIG.maxListings) {
       // Memory Management: Restart worker context every 20 pages
       if (pageNum > 1 && pageNum % 20 === 0) {
          await initPage();
       }

       // Safety Pause: Every 10 pages, sleep extra 2-4 seconds
       if (pageNum > 1 && pageNum % 10 === 0) {
          await sleep(2000 + Math.random() * 2000);
       }

       const url = buildUrl(searchTerm, pageNum);
       try {
           await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
           await autoScroll(page);
           
           const newItems = await page.evaluate(() => {
                const items = [];
                const cards = document.querySelectorAll('ul.srp-results > li.s-card, ul.srp-results > li.s-item');
                cards.forEach(card => {
                  try {
                    const text = card.textContent || '';
                    if (text.includes('Shop on eBay') || !text.match(/Sold\s/i)) return;
                    
                    const soldMatch = text.match(/Sold\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s*\d{4})?)/i);
                    const soldDate = soldMatch ? 'Sold ' + soldMatch[1] : '';
                    
                    let title = '';
                    const titleMatch = text.match(/Sold\s+\w+\s+\d+,?\s*\d*(.+?)Opens in a new/i);
                    if (titleMatch) {
                      title = titleMatch[1]
                        .replace(/^\d{4}/, '')
                        .replace(/^,?\s*/, '')
                        .replace(/^New Listing/i, '')
                        .trim();
                    }
                    if (!title || title.length < 5) return;
                    
                    const priceMatch = text.match(/\$(\d+(?:,\d{3})*\.?\d*)/);
                    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
                    if (!price) return;
                    
                    let condition = 'Unknown';
                    // ... (Simple condition parsing)
                    if (/Pre-Owned/i.test(text)) condition = 'Pre-Owned';
                    else if (/Brand\s*New/i.test(text)) condition = 'Brand New';
                    else if (/Refurbished/i.test(text)) condition = 'Refurbished';
                    else if (/Parts/i.test(text)) condition = 'For Parts';

                    const link = card.querySelector('a[href*="/itm/"]');
                    const url = link?.href || '';
                    const idMatch = url.match(/\/itm\/(\d+)/);
                    const itemId = idMatch ? idMatch[1] : '';
                    
                    // Image
                    let image = '';
                    const imgEl = card.querySelector('.s-item__image-img, .s-item__image img');
                    if (imgEl) {
                       image = imgEl.getAttribute('data-defer-load') || imgEl.src;
                       if (image && !image.startsWith('data:')) {
                         image = image.replace(/s-l\d+\.webp/, 's-l500.webp').replace(/s-l\d+\.jpg/, 's-l500.jpg');
                       }
                    }

                    items.push({ itemId, title: title.slice(0, 100), price, soldDate, condition, url, image });
                  } catch (e) {}
                });
                return items;
           });

           // RETRY LOGIC for Empty Pages
           if (newItems.length === 0) {
               const pageTitle = await page.title();
               const pageContent = await page.content();
               const isCaptcha = pageContent.includes('captcha') || 
                                 pageContent.includes('Security Measure') || 
                                 pageTitle.includes('Security Measure') || 
                                 pageTitle.includes('Pardon Our Interruption');
               
               console.log(`Page ${pageNum} returned 0 items. Title: "${pageTitle}". Block Detected: ${isCaptcha}`);

               if (consecutiveFailures < 2) {
                   const waitTime = isCaptcha ? 60000 : 5000; // Wait 60s if blocked, else 5s
                   console.log(`Retrying page ${pageNum} in ${waitTime/1000}s...`);
                   consecutiveFailures++;
                   await sleep(waitTime);
                   await initPage();
                   continue; 
               } else {
                   if (isCaptcha) console.log('Persistent Block. Stopping.');
                   else console.log('End of results or soft block. Stopping.');
                   break;
               }
           } else {
               consecutiveFailures = 0;
           }

           let validCount = 0;
           for (const item of newItems) {
               // EXTERNAL STOP CHECK (Database Match)
               if (await stopCheck(item)) {
                   console.log(`Stopping: Met external stop condition (Item ${item.itemId} exists).`);
                   hasMore = false;
                   break;
               }

               item.soldTimestamp = parseSoldDate(item.soldDate);
               if (item.soldTimestamp && item.soldTimestamp < targetCutoff) {
                   continue;
               }
               allListings.push(item);
               validCount++;
           }
           
           if (!hasMore) break; 

           if (validCount === 0) {
               console.log(`Stopping: All items on page ${pageNum} are older than target.`);
               hasMore = false;
               break;
           }

           pageNum++;
           await sleep(randomDelay());

       } catch (err) {
           console.error(`Error on page ${pageNum}: ${err.message}`);
           consecutiveFailures++;
           if (consecutiveFailures > 3) break;
           await initPage();
       }
    }

    clearInterval(partialInterval);

  } finally {
    await browser.close();
  }

  return analyzeData(allListings, searchTerm, targetDays);
}

module.exports = { scrapeEbay, analyzeData };