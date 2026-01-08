#!/bin/bash

cd /home/ploi/{site-folder}

git pull origin main

npm install --production

# Create logs directory if it doesn't exist
mkdir -p logs

# Restart the application using PM2
pm2 restart telem || pm2 start server.js --name telem

echo "Deployment completed successfully"
