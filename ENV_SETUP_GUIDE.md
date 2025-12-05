# 🔐 Environment Variables Setup Guide

## For Railway Server

Add these in Railway Dashboard → Variables:

```
DATABASE_URL = (Auto-generated when you add PostgreSQL)
WORKER_SECRET = raspberry-ebay-2024-YOUR-RANDOM-STRING-HERE
GEMINI_API_KEY = your-google-gemini-api-key-from-aistudio
NODE_ENV = production
PORT = 3000
```

### How to get GEMINI_API_KEY:
1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API Key"
3. Copy and paste into Railway

### Generate a secure WORKER_SECRET:
Run this in terminal to generate a random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## For Raspberry Pi Worker

Create file at `pi-worker/.env` with:

```env
API_URL=https://your-app-name.up.railway.app
WORKER_SECRET=same-exact-secret-from-railway
```

**IMPORTANT:** The `WORKER_SECRET` MUST match between Railway and Pi!

