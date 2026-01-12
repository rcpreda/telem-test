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
