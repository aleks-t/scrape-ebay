const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { scrapeEbay } = require('./scraper');

// CONFIG
const API_URL = process.env.API_URL || 'https://scrape-ebay-production.up.railway.app'; // Replace with your actual Railway URL if different
const WORKER_SECRET = process.env.WORKER_SECRET || 'my-secret-worker-key'; // Simple auth
const POLL_INTERVAL = 5000; // Check every 5 seconds

async function fetch(url, options = {}) {
    const { default: nodeFetch } = await import('node-fetch');
    return nodeFetch(url, options);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollForWork() {
    try {
        console.log('🔍 Checking for jobs...');
        const res = await fetch(`${API_URL}/api/worker/pending`, {
            headers: { 'x-worker-secret': WORKER_SECRET }
        });

        if (res.status === 404) {
            // No jobs available
            return;
        }

        if (!res.ok) {
            const text = await res.text();
            console.error(`❌ Server Error ${res.status}: ${text.substring(0, 200)}`);
            return;
        }

        // Check if response is JSON
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await res.text();
            console.error(`⚠️  Server returned HTML instead of JSON. This means the worker endpoints aren't deployed yet.`);
            console.error(`   Response preview: ${text.substring(0, 150)}...`);
            console.error(`   Please deploy the updated server/index.js to Railway first.`);
            return;
        }

        const job = await res.json();
        if (!job || !job.id) return;

        console.log(`🚀 Starting Job #${job.id}: "${job.searchTerm}" (${job.days} days)`);

        // Start Scraping
        const results = await scrapeEbay(job.searchTerm, { days: job.days }, async (progress) => {
            // Send Progress Update
            try {
                await fetch(`${API_URL}/api/worker/progress/${job.id}`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-worker-secret': WORKER_SECRET 
                    },
                    body: JSON.stringify(progress)
                });
                process.stdout.write(`\rPage ${progress.page}: ${progress.itemsFound} items found...`);
            } catch(e) {
                console.error('Failed to send progress:', e.message);
            }
        });

        console.log('\n✅ Job Complete. Sending results...');

        // Send Completion
        await fetch(`${API_URL}/api/worker/complete/${job.id}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-worker-secret': WORKER_SECRET 
            },
            body: JSON.stringify(results)
        });

        console.log('🎉 Results saved to server!');

    } catch (error) {
        console.error('Worker Error:', error.message);
    }
}

async function main() {
    console.log('👷 eBay Worker Started');
    console.log(`🔌 Connected to: ${API_URL}`);
    
    while (true) {
        await pollForWork();
        await sleep(POLL_INTERVAL);
    }
}

main();
