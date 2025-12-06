#!/bin/bash
# Setup script for Raspberry Pi eBay Worker with PM2

echo "🍓 Setting up eBay Worker on Raspberry Pi..."

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Go to worker directory
cd ~/ebay-scraper/pi-worker

# Stop any existing worker
pm2 delete ebay-worker 2>/dev/null || true

# Start the worker
echo "🚀 Starting worker with PM2..."
pm2 start index.js --name ebay-worker

# Save PM2 configuration
pm2 save

# Setup auto-start on boot
echo "⚡ Setting up auto-start on boot..."
pm2 startup

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Useful PM2 commands:"
echo "   pm2 status              - Check worker status"
echo "   pm2 logs ebay-worker    - View live logs"
echo "   pm2 restart ebay-worker - Restart worker"
echo "   pm2 stop ebay-worker    - Stop worker"
echo ""
echo "⚠️  IMPORTANT: Run the command shown above (starts with 'sudo env')"
echo "   This enables auto-start on Pi reboot!"

