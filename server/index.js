const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cron = require('node-cron');
require('dotenv').config();

const { scrapeEbay, analyzeData } = require('./services/scraper');
const { identifyItem } = require('./services/identifier');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// File Upload (Memory Storage for Identify)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ============================================================================
// DATABASE SETUP
// ============================================================================
const sequelize = new Sequelize(process.env.DATABASE_URL || 'sqlite::memory:', {
  dialect: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
  logging: false,
  dialectOptions: process.env.DATABASE_URL ? {
    ssl: { require: true, rejectUnauthorized: false }
  } : {}
});

// --- Models ---

// 1. Job History (Manual Searches)
const SearchJob = sequelize.define('SearchJob', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type: { type: DataTypes.ENUM('manual', 'watchlist'), defaultValue: 'manual' }, // New Field
  watchlistId: { type: DataTypes.UUID, allowNull: true }, // Link to watchlist if applicable
  searchTerm: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'), defaultValue: 'pending' },
  result: { type: DataTypes.JSON, allowNull: true },
  progress: { type: DataTypes.JSONB, allowNull: true }, // Live updates
  days: { type: DataTypes.INTEGER, defaultValue: 7 }, // Store config
  errorMessage: { type: DataTypes.TEXT, allowNull: true }
});

// 2. Watchlist (Automated Monitoring)
const Watchlist = sequelize.define('Watchlist', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  searchTerm: { type: DataTypes.STRING, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastRun: { type: DataTypes.DATE, allowNull: true },
  totalItemsFound: { type: DataTypes.INTEGER, defaultValue: 0 },
  newItemsSinceLastView: { type: DataTypes.INTEGER, defaultValue: 0 }
});

// 3. Items (Stored results to prevent duplicates and allow smart-stop)
const Item = sequelize.define('Item', {
  itemId: { type: DataTypes.STRING, primaryKey: true },
  watchlistId: { type: DataTypes.UUID, allowNull: true }, // Null if from ad-hoc search
  title: { type: DataTypes.STRING },
  price: { type: DataTypes.FLOAT },
  dateSold: { type: DataTypes.DATE },
  url: { type: DataTypes.TEXT },
  image: { type: DataTypes.TEXT },
  condition: { type: DataTypes.STRING }
});

// 4. Settings (Retention Policy)
const Settings = sequelize.define('Settings', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.JSON }
});

// Relationships
Watchlist.hasMany(Item, { foreignKey: 'watchlistId' });
Item.belongsTo(Watchlist, { foreignKey: 'watchlistId' });

// Sync DB
sequelize.sync().then(async () => {
  console.log('Database synced');
  // Init Default Settings if not exist
  await Settings.findOrCreate({ where: { key: 'retentionDays' }, defaults: { value: 30 } });
});

// ============================================================================
// JOB QUEUE (Single Lane Safety)
// ============================================================================
let isJobRunning = false;
const jobQueue = []; // Array of functions returning Promises

async function processQueue() {
  if (isJobRunning || jobQueue.length === 0) return;
  
  isJobRunning = true;
  const nextJob = jobQueue.shift();
  
  try {
    await nextJob();
  } catch (err) {
    console.error('Queue job failed:', err);
  } finally {
    isJobRunning = false;
    processQueue(); // Check for next
  }
}

function addToQueue(jobFn, priority = false) {
  if (priority) {
    jobQueue.unshift(jobFn); // Manual searches jump to front
  } else {
    jobQueue.push(jobFn);
  }
  processQueue();
}

// ============================================================================
// SCHEDULER (The Heartbeat)
// ============================================================================
// Run every hour: '0 * * * *'
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Hourly Scheduler Waking Up...');
  
  const activeWatches = await Watchlist.findAll({ where: { isActive: true } });
  console.log(`Found ${activeWatches.length} active watchlists. Creating jobs for workers.`);

  // Create pending jobs for workers to pick up
  for (const watch of activeWatches) {
      // Check if there's already a pending job for this watchlist
      const pending = await SearchJob.findOne({ 
          where: { watchlistId: watch.id, status: ['pending', 'processing'] } 
      });
      
      if (!pending) {
          // Fetch retention setting
          const retentionSetting = await Settings.findByPk('retentionDays');
          const days = retentionSetting ? retentionSetting.value : 30;

          await SearchJob.create({
              type: 'watchlist',
              watchlistId: watch.id,
              searchTerm: watch.searchTerm,
              days: days,
              status: 'pending'
          });
          console.log(`+ Queued Watchlist Job: ${watch.searchTerm}`);
      }
  }
});

// Data Cleanup Job (Run daily at 3 AM)
cron.schedule('0 3 * * *', async () => {
  console.log('🧹 Running Daily Cleanup...');
  const retentionSetting = await Settings.findByPk('retentionDays');
  const days = retentionSetting ? retentionSetting.value : 30;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const deleted = await Item.destroy({
      where: {
          dateSold: { [Op.lt]: cutoffDate }
      }
  });
  // Also clean up old completed jobs
  await SearchJob.destroy({
      where: {
          status: ['completed', 'failed'],
          createdAt: { [Op.lt]: cutoffDate }
      }
  });
  console.log(`Cleanup: Removed ${deleted} old items and old jobs.`);
});


// ============================================================================
// ROUTES
// ============================================================================

// --- WORKER API (For Raspberry Pi) ---
const WORKER_SECRET = process.env.WORKER_SECRET || 'my-secret-worker-key';

const authenticateWorker = (req, res, next) => {
    const secret = req.headers['x-worker-secret'];
    if (secret !== WORKER_SECRET) {
        return res.status(403).json({ error: 'Unauthorized Worker' });
    }
    next();
};

app.get('/api/worker/pending', authenticateWorker, async (req, res) => {
    // FIFO Queue: Get oldest pending job
    const job = await SearchJob.findOne({ 
        where: { status: 'pending' },
        order: [['createdAt', 'ASC']]
    });

    if (!job) return res.status(404).json({ message: 'No jobs available' });

    // Lock it so other workers don't grab it
    await job.update({ status: 'processing' });

    res.json({
        id: job.id,
        type: job.type,
        searchTerm: job.searchTerm,
        days: job.days
    });
});

app.post('/api/worker/progress/:id', authenticateWorker, async (req, res) => {
    const job = await SearchJob.findByPk(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    await job.update({ progress: req.body });
    res.json({ success: true });
});

app.post('/api/worker/complete/:id', authenticateWorker, async (req, res) => {
    const job = await SearchJob.findByPk(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const results = req.body; // Expecting { listings: [], ...analysis }

    try {
        if (job.type === 'watchlist' && job.watchlistId) {
            // Logic for Watchlist: Save individual items
            let newCount = 0;
            const watch = await Watchlist.findByPk(job.watchlistId);
            
            if (watch && results.listings) {
                for (const listing of results.listings) {
                    const exists = await Item.findOne({ where: { itemId: listing.itemId } });
                    if (!exists) {
                        await Item.create({
                            itemId: listing.itemId,
                            watchlistId: watch.id,
                            title: listing.title,
                            price: listing.price,
                            dateSold: listing.soldTimestamp ? new Date(listing.soldTimestamp) : null,
                            url: listing.url,
                            image: listing.image,
                            condition: listing.condition
                        });
                        newCount++;
                    }
                }
                
                watch.lastRun = new Date();
                watch.totalItemsFound += newCount;
                watch.newItemsSinceLastView += newCount;
                await watch.save();
            }
            // For watchlist jobs, we don't save the full JSON result to save DB space
            await job.update({ status: 'completed', result: { message: `Added ${newCount} items` } });
        } else {
            // Manual Search: Save full result
            await job.update({ status: 'completed', result: results });
        }
        
        res.json({ success: true });

    } catch (err) {
        console.error('Job completion failed:', err);
        await job.update({ status: 'failed', errorMessage: err.message });
        res.status(500).json({ error: err.message });
    }
});


// --- MANUAL SEARCH (Tab 1) ---
app.post('/api/search', async (req, res) => {
  const { searchTerm, days = 7 } = req.body;
  
  const job = await SearchJob.create({ 
    type: 'manual',
    searchTerm: searchTerm,
    days: days,
    status: 'pending',
    progress: { phase: 'QUEUED', page: 0, itemsFound: 0 }
  });

  res.json({ jobId: job.id });

  // NOTE: We NO LONGER trigger local scraping. 
  // The Worker (Raspberry Pi) will pick this up via /api/worker/pending
  console.log(`Job ${job.id} created. Waiting for worker...`);
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = await SearchJob.findByPk(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/history', async (req, res) => {
  const jobs = await SearchJob.findAll({
    limit: 10,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'searchTerm', 'status', 'createdAt', 'result']
  });
  res.json(jobs);
});

// --- WATCHLIST (Tab 2) ---
app.get('/api/watchlist', async (req, res) => {
  const list = await Watchlist.findAll({ order: [['createdAt', 'DESC']] });
  res.json(list);
});

app.post('/api/watchlist', async (req, res) => {
  const { searchTerm } = req.body;
  const exists = await Watchlist.findOne({ where: { searchTerm } });
  if (exists) return res.status(400).json({ error: 'Already tracking this term' });

  const watch = await Watchlist.create({ searchTerm });
  
  // Trigger Immediate First Run (Background)
  addToQueue(async () => {
      console.log(`Initializing Watchlist: ${searchTerm}`);
      try {
          // Deep scrape for first run (e.g. 30 days default)
          const results = await scrapeEbay(searchTerm, { days: 30 });
          let count = 0;
          for (const listing of results.listings) {
             await Item.findOrCreate({
                 where: { itemId: listing.itemId },
                 defaults: {
                     watchlistId: watch.id,
                     title: listing.title,
                     price: listing.price,
                     dateSold: listing.soldTimestamp,
                     url: listing.url,
                     image: listing.image,
                     condition: listing.condition
                 }
             });
             count++;
          }
          watch.lastRun = new Date();
          watch.totalItemsFound = count;
          await watch.save();
      } catch (e) {
          console.error('Init watchlist failed:', e);
      }
  });

  res.json(watch);
});

app.delete('/api/watchlist/:id', async (req, res) => {
  await Watchlist.destroy({ where: { id: req.params.id } });
  await Item.destroy({ where: { watchlistId: req.params.id } }); // Clean up items
  res.json({ success: true });
});

app.get('/api/watchlist/:id/items', async (req, res) => {
   const { page = 1, limit = 50 } = req.query;
   const offset = (page - 1) * limit;

   const items = await Item.findAndCountAll({
       where: { watchlistId: req.params.id },
       order: [['dateSold', 'DESC']],
       limit: parseInt(limit),
       offset: parseInt(offset)
   });

   // Reset "New Items" counter since user viewed them
   if (parseInt(page) === 1) {
       await Watchlist.update({ newItemsSinceLastView: 0 }, { where: { id: req.params.id } });
   }

   res.json(items);
});

app.get('/api/watchlist/:id/analysis', async (req, res) => {
  try {
    const watch = await Watchlist.findByPk(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watchlist not found' });

    const items = await Item.findAll({ 
      where: { watchlistId: req.params.id },
      order: [['dateSold', 'DESC']]
    });

    // Convert DB items back to Scraper format
    const rawListings = items.map(i => ({
        itemId: i.itemId,
        title: i.title,
        price: i.price,
        soldTimestamp: i.dateSold ? new Date(i.dateSold).getTime() : null,
        soldDate: i.dateSold ? new Date(i.dateSold).toLocaleDateString() : '',
        url: i.url,
        image: i.image,
        condition: i.condition || 'Unknown'
    }));

    const analysis = analyzeData(rawListings, watch.searchTerm, 30); // Default 30 days view
    res.json(analysis);

  } catch (err) {
    console.error('Analysis failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- SETTINGS (Tab 3) ---
app.get('/api/settings', async (req, res) => {
   const settings = await Settings.findAll();
   const map = {};
   settings.forEach(s => map[s.key] = s.value);
   res.json(map);
});

app.post('/api/settings', async (req, res) => {
   const { key, value } = req.body;
   await Settings.upsert({ key, value });
   res.json({ success: true });
});

// --- IDENTIFY (Gemini) ---
app.post('/api/identify', upload.single('image'), async (req, res) => {
  try {
    let imageInput;
    let isUrl = false;

    if (req.file) {
      imageInput = req.file.buffer;
    } else if (req.body.imageUrl) {
      imageInput = req.body.imageUrl;
      isUrl = true;
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const result = await identifyItem(imageInput, isUrl);
    res.json(result);

  } catch (error) {
    console.error('Identify failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve Frontend in Production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});