# 🚀 START HERE - Railway Deployment

## ✅ **UPLOAD THIS ENTIRE FOLDER TO RAILWAY**

```
📁 ebay-final/   <-- Upload this whole folder
```

---

## 🎯 Quick Links

**Choose your speed:**

1. **🏃‍♂️ Fast Track (10 min):** Read `QUICK_START.md`
2. **📋 Detailed Guide:** Read `DEPLOY_CHECKLIST.md` 
3. **🔐 Environment Setup:** Read `ENV_SETUP_GUIDE.md`

---

## 🎬 The 3-Step Process

### 1️⃣ Deploy to Railway (5 min)
- Upload `ebay-final` folder
- Add PostgreSQL database
- Set 3 environment variables
- Get your app URL

### 2️⃣ Setup Raspberry Pi (5 min)
- Copy `pi-worker` folder to Pi
- Run `npm install`
- Create `.env` file with Railway URL
- Start with PM2

### 3️⃣ Test It! (30 seconds)
- Open Railway URL
- Search for "iPhone 13"
- Watch Pi scrape eBay
- See beautiful results!

---

## 🔑 What You Need

**Before deploying, have these ready:**

1. **Railway Account** (free)
   - Sign up: https://railway.app

2. **WORKER_SECRET** (generate it):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Example output: `a7f8d9e2b3c4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0`

3. **GEMINI_API_KEY** (for image search):
   - Get it: https://aistudio.google.com/app/apikey
   - Free tier is fine!

4. **Raspberry Pi Access**
   - Your `pi-login` shortcut should work
   - Or: `ssh pi@raspberrypi.local`

---

## 📦 What's In This Folder?

```
ebay-final/
├── 📄 START_HERE.md          <-- You are here!
├── 📄 QUICK_START.md          <-- 10-min deployment guide
├── 📄 DEPLOY_CHECKLIST.md     <-- Detailed step-by-step
├── 📄 ENV_SETUP_GUIDE.md      <-- Environment variables explained
│
├── 🐳 Dockerfile              <-- Railway uses this to build
├── ⚙️  railway.json           <-- Railway configuration
├── 📦 package.json            <-- Root dependencies
│
├── 🖥️  server/                <-- Backend (Railway hosts this)
│   ├── index.js              <-- Main server + API endpoints
│   ├── services/             <-- Scraper + Gemini AI
│   └── package.json
│
├── 🎨 client/                <-- Frontend (beautiful dark UI)
│   ├── src/
│   │   └── App.jsx          <-- Main React app
│   ├── index.html
│   └── package.json
│
└── 🍓 pi-worker/             <-- Raspberry Pi worker
    ├── index.js              <-- Polls Railway for jobs
    ├── scraper.js            <-- Does eBay scraping
    ├── env.template          <-- Copy this to .env on Pi
    └── package.json
```

---

## 🎯 Your Railway URL Will Be:

After deployment: `https://ebay-final-production-xxxx.up.railway.app`

**You'll use this for:**
- ✅ Opening in browser (the UI)
- ✅ Configuring Pi worker (API_URL in .env)

---

## 🎨 What You're Deploying

A beautiful **market research tool** that:

✨ **Search Tab:** Analyze any eBay product
- Real-time scraping with live progress
- Price analysis, trends, velocity
- Interactive charts & graphs
- Image search with AI

📊 **Watchlist Tab:** Auto-track products daily
- Set it and forget it
- See new items appear automatically
- Historical data & trends

⚙️ **Settings Tab:** Configure data retention

**Why it's awesome:**
- 🎨 Dark mode with gradient accents
- 📊 Beautiful charts (Recharts)
- ⚡ Real-time progress updates
- 🔒 Secure Pi-to-server communication
- 🏠 Scraping from your home IP (Pi)

---

## 🆘 Need Help?

**Stuck?** Check:
1. `QUICK_START.md` - Step-by-step with copy/paste commands
2. `DEPLOY_CHECKLIST.md` - Troubleshooting section at bottom
3. `ENV_SETUP_GUIDE.md` - Environment variable details

**Common Issues:**
- ❌ "Unauthorized Worker" → WORKER_SECRET doesn't match
- ❌ Pi not connecting → Check API_URL in Pi's .env
- ❌ Build fails → Check Railway has PostgreSQL added

---

## 🚀 Ready? Start Here:

```bash
# 1. Open quick start guide
open QUICK_START.md

# 2. Or deploy now with Railway CLI:
npm install -g @railway/cli
railway login
railway init
railway up
```

---

## 💡 Pro Tip

After deploying, bookmark your Railway URL and add it to your phone's home screen. Now you can do market research from anywhere! 📱

---

**Let's deploy!** 🎉

