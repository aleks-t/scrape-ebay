/**
 * LIGHTWEIGHT RAILWAY SERVER
 * Just handles job queue and serves frontend
 * Pi does all the heavy lifting
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for results

// File upload for image identification
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Import Gemini identifier (but make it optional)
let identifyItem = null;
try {
  const idService = require('../services/identifier');
  identifyItem = idService.identifyItem;
  console.log('✅ Gemini AI image identification enabled');
} catch (e) {
  console.log('⚠️  Gemini disabled (no API key or module missing)');
}

// In-memory storage (resets on deploy - that's OK!)
const jobs = new Map();
const results = new Map();
let jobCounter = 0;
let lastWorkerPing = null; // Track when Pi last checked in

const WORKER_SECRET = process.env.WORKER_SECRET || 'change-me';

// Middleware to check worker auth
const authenticateWorker = (req, res, next) => {
  const secret = req.headers['x-worker-secret'];
  if (secret !== WORKER_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

// ============================================================================
// FRONTEND API (for browser)
// ============================================================================

// Health check - shows if Pi is connected
app.get('/api/health', (req, res) => {
  const isWorkerActive = lastWorkerPing && (Date.now() - lastWorkerPing < 30000); // 30 second timeout
  res.json({
    server: 'online',
    worker: isWorkerActive ? 'connected' : 'disconnected',
    lastWorkerPing: lastWorkerPing ? new Date(lastWorkerPing).toISOString() : null,
    jobsInQueue: Array.from(jobs.values()).filter(j => j.status === 'pending').length
  });
});

// Create a new search job
app.post('/api/search', (req, res) => {
  const { searchTerm, days = 7 } = req.body;
  const jobId = `job-${Date.now()}-${++jobCounter}`;
  
  jobs.set(jobId, {
    id: jobId,
    searchTerm,
    days,
    status: 'pending',
    createdAt: new Date(),
    progress: null
  });
  
  console.log(`📝 New job created: ${jobId} - "${searchTerm}"`);
  res.json({ jobId });
});

// Get job status
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  // If completed, attach the result
  if (job.status === 'completed') {
    job.result = results.get(req.params.id);
  }
  
  res.json(job);
});

// Get recent job history
app.get('/api/history', (req, res) => {
  const recentJobs = Array.from(jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map(j => ({
      id: j.id,
      searchTerm: j.searchTerm,
      status: j.status,
      createdAt: j.createdAt
    }));
  
  res.json(recentJobs);
});

// Image Identification (Gemini AI)
app.post('/api/identify', upload.single('image'), async (req, res) => {
  if (!identifyItem) {
    return res.status(503).json({ 
      error: 'Image identification not available. Set GEMINI_API_KEY on Railway.' 
    });
  }

  try {
    let imageInput;
    let isUrl = false;

    if (req.file) {
      // Image uploaded as file
      imageInput = req.file.buffer;
    } else if (req.body.imageUrl) {
      // Image URL provided
      imageInput = req.body.imageUrl;
      isUrl = true;
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`🖼️  Identifying image${isUrl ? ' from URL' : ' upload'}...`);
    const result = await identifyItem(imageInput, isUrl);
    
    console.log(`✅ Identified: "${result.searchTerm}"`);
    res.json(result);

  } catch (error) {
    console.error('❌ Image identification failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// WORKER API (for Raspberry Pi)
// ============================================================================

// Pi polls this to get pending jobs
app.get('/api/worker/pending', authenticateWorker, (req, res) => {
  lastWorkerPing = Date.now(); // Update heartbeat
  
  // Find oldest pending job
  const pendingJobs = Array.from(jobs.values())
    .filter(j => j.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  
  if (pendingJobs.length === 0) {
    return res.status(404).json({ message: 'No jobs available' });
  }
  
  const job = pendingJobs[0];
  job.status = 'processing';
  job.startedAt = new Date();
  
  console.log(`🍓 Pi picked up job: ${job.id}`);
  
  res.json({
    id: job.id,
    searchTerm: job.searchTerm,
    days: job.days
  });
});

// Pi sends progress updates
app.post('/api/worker/progress/:id', authenticateWorker, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  job.progress = req.body;
  res.json({ success: true });
});

// Pi sends final results
app.post('/api/worker/complete/:id', authenticateWorker, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  job.status = 'completed';
  job.completedAt = new Date();
  results.set(req.params.id, req.body);
  
  console.log(`✅ Job completed: ${job.id}`);
  res.json({ success: true });
});

// Pi reports errors
app.post('/api/worker/fail/:id', authenticateWorker, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  job.status = 'failed';
  job.errorMessage = req.body.error;
  
  console.log(`❌ Job failed: ${job.id}`);
  res.json({ success: true });
});

// Pi requests data cleanup (based on retention days from settings)
app.post('/api/worker/cleanup', authenticateWorker, (req, res) => {
  const { retentionDays } = req.body;
  console.log(`🧹 Pi requesting cleanup: ${retentionDays} days retention`);
  // Pi will handle actual cleanup locally
  res.json({ success: true, message: `Clean up data older than ${retentionDays} days` });
});

// ============================================================================
// SERVE FRONTEND (in production)
// ============================================================================
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ============================================================================
// CLEANUP (optional - prevents memory leak)
// ============================================================================
setInterval(() => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < oneDayAgo) {
      jobs.delete(id);
      results.delete(id);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

// ============================================================================
// START
// ============================================================================
app.listen(PORT, () => {
  console.log(`🚀 Railway Server running on port ${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Worker auth: ${WORKER_SECRET === 'change-me' ? '⚠️  DEFAULT (change it!)' : '✅ Set'}`);
});

