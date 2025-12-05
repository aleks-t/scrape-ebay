# ✅ Pre-Deployment Checklist

## 🎯 Upload to Railway: **The `ebay-final` folder**

### What Railway Needs:
```
ebay-final/
├── Dockerfile          ✅ (builds everything)
├── railway.json        ✅ (tells Railway how to deploy)
├── package.json        ✅ (root dependencies)
├── server/             ✅ (API + database)
├── client/             ✅ (React UI)
└── pi-worker/          ⚠️  (don't deploy this - it goes on Pi)
```

---

## 📋 Step-by-Step Deployment

### 1️⃣ **On Railway** (5 minutes)

1. **Create Project**
   - Go to https://railway.app
   - Click "New Project"
   - Choose "Deploy from GitHub repo" OR "Empty Project"

2. **Add PostgreSQL Database**
   - Click "+ New"
   - Select "Database" → "PostgreSQL"
   - Railway will auto-generate `DATABASE_URL`

3. **Deploy Your Code**
   - **Option A (GitHub):** Connect your repo
   - **Option B (Direct Upload):** 
     ```bash
     cd ~/Desktop/ebay-final
     railway login
     railway link
     railway up
     ```
   - **Option C (CLI):** Use Railway CLI
     ```bash
     npm install -g @railway/cli
     cd ~/Desktop/ebay-final
     railway login
     railway init
     railway up
     ```

4. **Set Environment Variables**
   In Railway Dashboard → Your Project → Variables:
   ```
   WORKER_SECRET = [generate with command below]
   GEMINI_API_KEY = [from Google AI Studio]
   NODE_ENV = production
   ```

   **Generate secure secret:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Get Your App URL**
   - Railway will give you: `https://your-app.up.railway.app`
   - Save this! You'll need it for the Pi

---

### 2️⃣ **On Your Raspberry Pi** (5 minutes)

1. **SSH into Pi:**
   ```bash
   pi-login
   # or: ssh pi@raspberrypi.local
   ```

2. **Copy Worker Code to Pi:**
   ```bash
   # On your Mac, from ebay-final directory:
   scp -r pi-worker pi@raspberrypi.local:~/ebay-worker
   
   # OR manually copy the pi-worker folder
   ```

3. **Install Dependencies on Pi:**
   ```bash
   cd ~/ebay-worker
   npm install
   ```

4. **Install Chrome on Pi (if not already):**
   ```bash
   sudo apt update
   sudo apt install -y chromium-browser chromium-codecs-ffmpeg
   ```

5. **Create .env file on Pi:**
   ```bash
   nano .env
   ```
   
   Paste (replace with your values):
   ```env
   API_URL=https://your-app.up.railway.app
   WORKER_SECRET=same-secret-from-railway
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
   ```
   Save: `Ctrl+X`, `Y`, `Enter`

6. **Test the Worker:**
   ```bash
   node index.js
   ```
   You should see: "👷 eBay Worker Started"

7. **Set Up Auto-Restart with PM2:**
   ```bash
   sudo npm install -g pm2
   pm2 start index.js --name ebay-worker
   pm2 save
   pm2 startup
   # Run the command it outputs
   ```

8. **Verify it's running:**
   ```bash
   pm2 status
   pm2 logs ebay-worker
   ```

---

### 3️⃣ **Test Everything** (2 minutes)

1. Open your Railway URL in browser
2. Enter search: "sony playstation 5"
3. Set days: 7
4. Click "Analyze"
5. Watch the Pi logs: `pm2 logs ebay-worker`
6. See results appear in browser!

---

## 🎉 You're Done!

Your system is now:
- ✅ **Railway**: Hosting beautiful UI + database
- ✅ **Pi**: Doing the heavy scraping work
- ✅ **Secure**: Worker authenticated with secret
- ✅ **Auto-restart**: PM2 keeps worker alive

---

## 🐛 Troubleshooting

### Railway build fails?
- Check Dockerfile is present
- View build logs in Railway dashboard
- Ensure PostgreSQL is added

### Pi not connecting?
```bash
# Check Pi logs
pm2 logs ebay-worker

# Test connection manually
curl -H "x-worker-secret: YOUR_SECRET" https://your-app.up.railway.app/api/worker/pending
```

### "Unauthorized Worker" error?
- Check WORKER_SECRET matches on both Railway and Pi
- It's case-sensitive!

### No jobs appearing?
- Create a search on the website first
- Check Railway logs for job creation
- Check Pi is polling: `pm2 logs ebay-worker`

---

## 📞 Need Help?

Check logs:
- **Railway**: Dashboard → Deployments → View Logs
- **Pi**: `pm2 logs ebay-worker`
- **Pi errors**: `pm2 logs ebay-worker --err`

