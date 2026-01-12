# Docker Commands

## Local Development

### Build and run (with logs in terminal)
```bash
docker compose up --build
```

### Build and run in background
```bash
docker compose up -d --build
```

### View logs
```bash
docker compose logs -f
```

### Stop containers
```bash
docker compose down
```

### Restart container
```bash
docker compose restart
```

## Production Deployment (77.42.31.151)

### First Time Setup
```bash
# 1. Stop existing MongoDB (if running)
sudo systemctl stop mongod
sudo systemctl disable mongod

# 2. Stop PM2 server (if running)
pm2 stop telem
pm2 delete telem
pm2 save

# 3. Clone repo (first time only)
cd /opt
git clone <your-repo-url> telem
cd telem

# 4. Start Docker
docker compose up -d --build

# 5. Check status
docker compose ps
docker compose logs -f
```

### Redeploy (update code)
```bash
# 1. Go to project folder
cd /opt/telem

# 2. Pull latest code
git pull

# 3. Rebuild and restart containers (data is preserved)
docker compose up -d --build

# 4. Check logs
docker compose logs -f
```

### Quick Redeploy (one-liner)
```bash
cd /opt/telem && git pull && docker compose up -d --build
```

## Useful Commands

### Check running containers
```bash
docker ps
```

### Check container status
```bash
docker compose ps
```

### View container resource usage
```bash
docker stats telem-server
```

### Enter container shell
```bash
docker exec -it telem-server sh
```

### View logs from file (inside container)
```bash
docker exec -it telem-server cat /app/logs/server/2024-01-15_14.txt
```

### Rebuild without cache
```bash
docker compose build --no-cache
docker compose up -d
```

### Remove all stopped containers and images
```bash
docker system prune -a
```

## MongoDB Commands

### Connect to MongoDB shell
```bash
docker exec -it telem-mongo mongosh
```

### View databases
```bash
docker exec -it telem-mongo mongosh --eval "show dbs"
```

### Query raw data (FMC003)
```bash
docker exec -it telem-mongo mongosh telem --eval "db.raw_fmc003.find().limit(5).pretty()"
```

### Query parsed records (FMC003)
```bash
docker exec -it telem-mongo mongosh telem --eval "db.records_fmc003.find().limit(5).pretty()"
```

### List all devices
```bash
docker exec -it telem-mongo mongosh telem --eval "db.devices.find().pretty()"
```

### Count records by IMEI
```bash
docker exec -it telem-mongo mongosh telem --eval "db.records_fmc003.countDocuments({imei: '864275079658715'})"
```

### Get latest record
```bash
docker exec -it telem-mongo mongosh telem --eval "db.records_fmc003.find().sort({timestamp: -1}).limit(1).pretty()"
```

### Backup MongoDB
```bash
docker exec telem-mongo mongodump --out /data/backup
docker cp telem-mongo:/data/backup ./mongo-backup
```

### Restore MongoDB
```bash
docker cp ./mongo-backup telem-mongo:/data/backup
docker exec telem-mongo mongorestore /data/backup
```

## REST API (Port 3000)

Base URL: `http://localhost:3000` (local) or `http://77.42.31.151:3000` (production)

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/devices` | List all devices |
| GET | `/devices/:imei` | Get device by IMEI |
| PUT | `/devices/:imei` | Update device info |
| GET | `/devices/:imei/stats` | Get device statistics |
| GET | `/devices/:imei/latest` | Get latest record |
| GET | `/devices/:imei/records` | Get records (limit, skip) |
| GET | `/devices/:imei/records/range` | Get records in time range |
| GET | `/devices/:imei/raw` | Get raw data |
| GET | `/devices/:imei/trips` | Get trips (ignition-based) |

### Examples

#### List all devices
```bash
curl http://localhost:3000/devices
```

#### Get device info
```bash
curl http://localhost:3000/devices/864275079658715
```

#### Update device (add car info)
```bash
curl -X PUT http://localhost:3000/devices/864275079658715 \
  -H "Content-Type: application/json" \
  -d '{"carBrand": "BMW", "carModel": "320i", "plateNumber": "B-123-ABC"}'
```

#### Get device statistics
```bash
curl http://localhost:3000/devices/864275079658715/stats
```

#### Get latest position
```bash
curl http://localhost:3000/devices/864275079658715/latest
```

#### Get last 50 records
```bash
curl "http://localhost:3000/devices/864275079658715/records?limit=50"
```

#### Get records in time range
```bash
curl "http://localhost:3000/devices/864275079658715/records/range?from=2024-01-15T00:00:00Z&to=2024-01-15T23:59:59Z"
```

#### Get trips
```bash
curl http://localhost:3000/devices/864275079658715/trips
```

#### Health check
```bash
curl http://localhost:3000/health
```
