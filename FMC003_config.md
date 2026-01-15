# FMC003 Configuration

## Device Info
- **Model**: FMC003 (OBD Tracker)
- **IMEI**: 864275079658715
- **VIN**: WBAPE11070WJ80558

## Server Settings
| Setting | Value |
|---------|-------|
| Server IP | 77.42.31.151 |
| Server Port | 5027 |
| Protocol | TCP |
| APN | internet |

## Data Acquisition

### On Stop (vehicle parked)
| Setting | Value | Description |
|---------|-------|-------------|
| Min Period | 300 sec (5 min) | Collect data every 5 minutes |
| Send Period | 60 sec (1 min) | Send to server every 1 minute |

### On Moving (vehicle moving)
| Setting | Value | Description |
|---------|-------|-------------|
| Min Period | 20 sec | Max time between records |
| Send Period | 10 sec | Send to server every 10 seconds |
| Min Distance | 50 m | New record if moved 50m |
| Min Angle | 10° | New record on 10°+ turn |
| Min Speed Delta | 10 km/h | New record on 10+ km/h speed change |

### On Demand Tracking
| Setting | Value |
|---------|-------|
| Period | 0 (disabled) |
| Duration | 0 (disabled) |

## Expected Data Volume
- **On Stop (8 hours parked)**: ~96 records/night
- **On Moving (1 hour driving)**: ~180-300 records (depending on route)

## IO Elements Received
| ID | Name | Description |
|----|------|-------------|
| 16 | Total Odometer | Meters |
| 21 | GSM Signal | 0-5 |
| 24 | Speed | km/h |
| 66 | External Voltage | mV (car battery) |
| 67 | Battery Voltage | mV (device battery) |
| 69 | GNSS Status | 0=no fix, 1=fix |
| 181 | GNSS PDOP | Position accuracy |
| 182 | GNSS HDOP | Horizontal accuracy |
| 239 | Ignition | 0=off, 1=on |
| 240 | Movement | 0=stopped, 1=moving |
| 241 | GSM Operator | Operator code |
| 256 | VIN | Vehicle ID Number |


- https://wiki.teltonika-gps.com/view/FMC003_Parameter_list - lista completă de parametri IO
- https://wiki.teltonika-gps.com/view/FMC003_Features_settings - configurare funcționalități
- https://www.teltonika-gps.com/products/trackers/obd-data/fmc003 - pagina oficială

---

## API Documentation

### Base URL
- Local: `http://localhost:3000`
- Live: `http://77.42.31.151:3000`

### Device Management

#### Register new device (whitelist)
```bash
POST /devices
Content-Type: application/json

{
  "imei": "123456789012345",      # Required, 15 digits
  "modemType": "FMC003",          # Optional, default: FMC003
  "carBrand": "BMW",              # Optional
  "carModel": "E46",              # Optional
  "plateNumber": "B123ABC",       # Optional
  "notes": "Company car"          # Optional
}

# Response: 201 Created
{
  "imei": "123456789012345",
  "modemType": "FMC003",
  "approved": true,
  "createdAt": "2026-01-15T10:00:00.000Z"
}
```

#### List all devices
```bash
GET /devices

# Response: 200 OK
[
  {
    "imei": "864275079658715",
    "modemType": "FMC003",
    "vin": "WBAPE11070WJ80558",
    "approved": true,
    "lastSeen": "2026-01-15T10:00:00.000Z"
  }
]
```

#### Get device by IMEI
```bash
GET /devices/:imei
```

#### Update device info
```bash
PUT /devices/:imei
Content-Type: application/json

{
  "carBrand": "BMW",
  "carModel": "320i E46",
  "plateNumber": "B123ABC",
  "notes": "Updated notes"
}
```

#### Approve/Reject device
```bash
PATCH /devices/:imei/approve
Content-Type: application/json

{ "approved": true }   # or false to reject
```

#### Delete device
```bash
DELETE /devices/:imei
```

### Telemetry Data

#### Get latest record
```bash
GET /devices/:imei/latest
```

#### Get records (paginated)
```bash
GET /devices/:imei/records?limit=100&skip=0
```

#### Get records in time range
```bash
GET /devices/:imei/records/range?from=2026-01-12T00:00:00Z&to=2026-01-12T23:59:59Z
```

### Trips

#### Get trips
```bash
GET /devices/:imei/trips?limit=20

# Response includes:
# - startTime, endTime, duration
# - distanceKm, distanceEstimated (if calculated from speed)
# - maxSpeed, avgSpeedMoving, avgSpeedTotal
# - fuelUsedLiters, fuelPer100km, fuelFromGps (only if trip > 2km and > 5min)
# - startPosition, endPosition (GPS with satellites > 0)
```

### Daily Statistics

#### Get daily stats
```bash
GET /devices/:imei/daily/:date?    # date format: YYYY-MM-DD, default: today

# Response includes:
# - distance (meters, km)
# - fuel (usedLiters, per100km, estimated flag)
# - drivingTime (minutes, formatted)
# - speed (max, avg)
# - voltage.engineOn (batteryAvg, externalAvg/Min/Max)
# - voltage.engineOff (batteryAvg, externalAvg/Min/Max)
# - engine (rpmMax, rpmAvg, coolantTempMax/Avg, loadAvg)
# - tripCount
```

#### Get daily stats for date range
```bash
GET /devices/:imei/daily-range?from=2026-01-01&to=2026-01-15
```

### Device Stats
```bash
GET /devices/:imei/stats

# Response: totalRecords, todayRecords, firstRecord, lastRecord, lastPosition
```

### Raw Data
```bash
GET /devices/:imei/raw?limit=50
```

---

## Security

### IMEI Whitelist
Server only accepts connections from devices with `approved: true` in database.
- Unknown IMEI → connection rejected with 0x00
- IMEI with `approved: false` → connection rejected
- Approved IMEI → connection accepted with 0x01

### Connection Timeout
Connections that don't send valid IMEI within 15 seconds are automatically closed.

---

## Data Notes

### Fuel Consumption
- `fuelUsedGps` (IO 12) is GPS-estimated, not OBD real
- Only calculated for trips > 2km and > 5 minutes
- `fuelFromGps: true` flag indicates estimation
- For accurate fuel, configure OBD Fuel Rate in Teltonika Configurator

### Distance
- `totalOdometer` (IO 16) requires GPS fix (satellites > 0)
- If odometer doesn't change but speed exists, distance is estimated from speed × time
- `distanceEstimated: true` flag indicates calculation from speed

### Voltage
- `engineOn` = ignition=1 AND (movement=1 OR speed>0 OR rpm>0)
- `engineOff` = everything else
- Separates alternator charging vs battery-only readings

### Trip Detection
- Trip starts when engine ON (ignition=1 OR rpm>0)
- Trip ends after engine OFF for > 60 seconds
- Filters out trips < 2 minutes AND < 100 meters