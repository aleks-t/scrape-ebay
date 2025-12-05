# 🚀 eBay Market Pulse - Railway + Raspberry Pi Edition

Beautiful market research tool that scrapes eBay sold listings with distributed architecture.

## 🏗️ Architecture

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│  Web UI     │ ◄─────► │   Railway    │ ◄─────► │ Raspberry Pi │
│  (Browser)  │  HTTPS  │  + Postgres  │  HTTPS  │   (Worker)   │
└─────────────┘         └──────────────┘         └──────────────┘
```

- **Railway**: Hosts the web server + database + job queue
- **Raspberry Pi**: Does the actual eBay scraping (residential IP = better success)
- **PostgreSQL**: Stores jobs, watchlists, and results

## 📦 Deployment Guide

### 1️⃣ Deploy to Railway

1. Create new project on Railway: https://railway.app
2. Add **PostgreSQL** database (Railway will auto-provide `DATABASE_URL`)
3. Connect this GitHub repo OR upload folder directly
4. Set environment variables in Railway dashboard:
   - `WORKER_SECRET` - Create a secure random string
   - `GEMINI_API_KEY` - Get from https://aistudio.google.com/app/apikey
   - `NODE_ENV=production`
5. Deploy! Railway will build using Dockerfile

### 2️⃣ Configure Raspberry Pi Worker

SSH into your Pi:
```bash
ssh pi@your-pi-address
# or use your shortcut: pi-login
```

Install dependencies:
```bash
cd ~
git clone <this-repo> ebay-worker
cd ebay-worker/pi-worker
npm install
```

Create `.env` file:
```bash
nano .env
```

Add:
```env
API_URL=https://your-railway-app.up.railway.app
WORKER_SECRET=same-secret-you-used-on-railway
```

Install PM2 (process manager):
```bash
sudo npm install -g pm2
pm2 start index.js --name ebay-worker
pm2 save
pm2 startup  # Follow the command it gives you
```

### 3️⃣ Test It!

1. Open your Railway app URL
2. Enter a search term (e.g., "iPhone 13")
3. Watch the Pi pick up the job and start scraping
4. See real-time progress in the web UI
5. Get beautiful analysis results!

## 🔧 Environment Variables

### Railway Server
- `DATABASE_URL` - Auto-provided by Railway PostgreSQL
- `WORKER_SECRET` - Shared secret for Pi authentication
- `GEMINI_API_KEY` - For image identification
- `NODE_ENV=production`
- `PORT=3000` (Railway auto-assigns)

### Raspberry Pi Worker
- `API_URL` - Your Railway app URL
- `WORKER_SECRET` - Same as server
- `PUPPETEER_EXECUTABLE_PATH` - (Optional) Path to Chrome

## 📊 Features

✅ Real-time eBay scraping with smart date filtering  
✅ Beautiful dark UI with live progress updates  
✅ Watchlist system - auto-track items daily  
✅ AI-powered image search (Gemini)  
✅ Price analysis, trends, arbitrage opportunities  
✅ Interactive charts & data visualization  
✅ Distributed scraping (Railway handles UI, Pi does work)  

## 🛠️ Local Development

```bash
# Terminal 1: Run server
cd server
npm install
npm run dev

# Terminal 2: Run client
cd client
npm install
npm run dev

# Terminal 3: Run worker (optional)
cd pi-worker
npm install
npm start
```

## 📝 Notes

- First scrape initializes watchlist (may take 5-10 min)
- Pi polls every 5 seconds for new jobs
- Data auto-deletes after retention period (default 30 days)
- Railway free tier: 500 hours/month (plenty for this!)

## 🐛 Troubleshooting

**Pi not picking up jobs?**
- Check `API_URL` is correct in Pi's `.env`
- Check `WORKER_SECRET` matches on both sides
- Check Pi's PM2 logs: `pm2 logs ebay-worker`

**Railway deployment failed?**
- Check build logs in Railway dashboard
- Ensure PostgreSQL is added to project
- Verify all env vars are set

**Scraping not working?**
- eBay may be rate-limiting - Pi will retry
- Check Pi has internet connection
- Ensure Chrome is installed on Pi: `google-chrome-stable --version`

---

Made with ❤️ for market research

