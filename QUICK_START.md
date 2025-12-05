# ⚡ Quick Start - Deploy in 10 Minutes

## 🎯 **Upload This Folder:** `ebay-final/`

---

## Step 1: Railway Setup (5 min)

### A. Go to Railway
https://railway.app/new

### B. Create New Project
- Click "Deploy from GitHub repo" OR "Empty Project"
- If empty, you'll use Railway CLI (see below)

### C. Add PostgreSQL
- Click "+ New" → "Database" → "PostgreSQL"
- Wait for it to provision (30 seconds)

### D. Set Environment Variables
Click on your service → "Variables" tab → Add:

```
WORKER_SECRET = [paste the secret generated below]
GEMINI_API_KEY = [get from https://aistudio.google.com/app/apikey]
NODE_ENV = production
```

**Generate WORKER_SECRET (run on your Mac):**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output!

### E. Deploy Code

**Option 1: Railway CLI (Easiest)**
```bash
npm install -g @railway/cli
cd ~/Desktop/ebay-final
railway login
railway init
railway up
```

**Option 2: GitHub**
- Push `ebay-final` to GitHub
- Connect repo in Railway dashboard

### F. Get Your URL
- Railway shows: `https://ebay-final-production-xxxx.up.railway.app`
- **SAVE THIS!** You need it for the Pi

---

## Step 2: Raspberry Pi Setup (5 min)

### A. Copy Worker to Pi

**On your Mac:**
```bash
cd ~/Desktop/ebay-final
scp -r pi-worker pi@raspberrypi.local:~/ebay-worker

# OR if you have a shortcut:
# Use your pi-login command, then manually copy the folder
```

### B. Setup on Pi

**SSH into Pi:**
```bash
ssh pi@raspberrypi.local
# or: pi-login
```

**Install dependencies:**
```bash
cd ~/ebay-worker
npm install
```

**Install Chrome:**
```bash
sudo apt update
sudo apt install -y chromium-browser
```

**Create config:**
```bash
nano .env
```

**Paste this (replace YOUR values):**
```env
API_URL=https://your-railway-url.up.railway.app
WORKER_SECRET=paste-the-same-secret-from-railway
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

Save: `Ctrl+X`, `Y`, `Enter`

**Start worker:**
```bash
npm install -g pm2
pm2 start index.js --name ebay-worker
pm2 save
pm2 startup
# Run the command it gives you (copy/paste the sudo command)
```

**Check it's working:**
```bash
pm2 logs ebay-worker
```

You should see: "👷 eBay Worker Started" and "🔌 Connected to: [your-url]"

---

## Step 3: Test! (1 min)

1. Open your Railway URL in browser
2. Enter: `iPhone 13 Pro`
3. Days: `7`
4. Click **Analyze**
5. Watch magic happen! ✨

---

## 🎉 Done!

Your app is live! The Pi will:
- Poll Railway every 5 seconds
- Pick up scraping jobs
- Send results back
- Appear in your beautiful UI

---

## 💡 Pro Tips

**View Pi logs anytime:**
```bash
pm2 logs ebay-worker
```

**Restart Pi worker:**
```bash
pm2 restart ebay-worker
```

**View Railway logs:**
Go to Railway Dashboard → Your Service → Deployments → View Logs

**Add to watchlist:**
Search for something, then click "Track Daily" button!

---

## 🆘 Troubleshooting

**Can't deploy to Railway?**
- Make sure you're in `ebay-final` folder
- Try: `railway link` to connect to existing project

**Pi not connecting?**
- Check `.env` file has correct URL and secret
- Test: `curl https://your-url.up.railway.app`
- Check: `pm2 logs ebay-worker --err`

**"Unauthorized Worker" error?**
- WORKER_SECRET must match exactly on Railway and Pi
- No extra spaces or quotes!

**No results showing?**
- First search takes 5-10 min (it's scraping eBay!)
- Check Railway logs for errors
- Make sure PostgreSQL is added

---

Need more details? Read `DEPLOY_CHECKLIST.md`

