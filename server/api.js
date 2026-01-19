const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
const { getCollectionName } = require('./models');

const app = express();
const API_PORT = process.env.API_PORT || 3000;
const API_KEY = process.env.API_KEY || 'telem-secret-key-change-me';

app.use(cors());
app.use(express.json());

// API Key authentication middleware
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized - Invalid or missing API key' });
    }
    next();
};

// Health check (no auth required)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply API key auth to all routes below
app.use(apiKeyAuth);

// ============ DEVICES ============

// List all devices
app.get('/devices', async (req, res) => {
    try {
        const db = getDb();
        const devices = await db.collection('devices')
            .find({})
            .sort({ lastSeen: -1 })
            .toArray();
        res.json(devices);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get device by IMEI
app.get('/devices/:imei', async (req, res) => {
    try {
        const db = getDb();
        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json(device);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Register new device (whitelist)
app.post('/devices', async (req, res) => {
    try {
        const db = getDb();
        const { imei, modemType, carBrand, carModel, plateNumber, notes } = req.body;

        if (!imei || !/^\d{15}$/.test(imei)) {
            return res.status(400).json({ error: 'Invalid IMEI (must be 15 digits)' });
        }

        // Check if already exists
        const existing = await db.collection('devices').findOne({ imei });
        if (existing) {
            return res.status(409).json({ error: 'Device already registered', device: existing });
        }

        const device = {
            imei,
            modemType: modemType || 'FMC003',
            carBrand: carBrand || null,
            carModel: carModel || null,
            plateNumber: plateNumber || null,
            notes: notes || null,
            approved: true,
            createdAt: new Date()
        };

        await db.collection('devices').insertOne(device);
        res.status(201).json(device);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve/reject device
app.patch('/devices/:imei/approve', async (req, res) => {
    try {
        const db = getDb();
        const { approved } = req.body;

        const result = await db.collection('devices').updateOne(
            { imei: req.params.imei },
            { $set: { approved: approved !== false, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        res.json(device);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete device
app.delete('/devices/:imei', async (req, res) => {
    try {
        const db = getDb();
        const result = await db.collection('devices').deleteOne({ imei: req.params.imei });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device deleted', imei: req.params.imei });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update device info (car brand, model, plate, etc.)
app.put('/devices/:imei', async (req, res) => {
    try {
        const db = getDb();
        const { carBrand, carModel, plateNumber, notes } = req.body;

        const update = { updatedAt: new Date() };
        if (carBrand !== undefined) update.carBrand = carBrand;
        if (carModel !== undefined) update.carModel = carModel;
        if (plateNumber !== undefined) update.plateNumber = plateNumber;
        if (notes !== undefined) update.notes = notes;

        const result = await db.collection('devices').updateOne(
            { imei: req.params.imei },
            { $set: update }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        res.json(device);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ RECORDS ============

// Get records for a device
app.get('/devices/:imei/records', async (req, res) => {
    try {
        const db = getDb();

        // Get device to find modem type
        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const skip = parseInt(req.query.skip) || 0;

        const records = await db.collection(collection)
            .find({ imei: req.params.imei })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        res.json({
            device: req.params.imei,
            modemType: device.modemType,
            count: records.length,
            records
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get latest record for a device
app.get('/devices/:imei/latest', async (req, res) => {
    try {
        const db = getDb();

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);
        const record = await db.collection(collection)
            .findOne({ imei: req.params.imei }, { sort: { timestamp: -1 } });

        if (!record) {
            return res.status(404).json({ error: 'No records found' });
        }

        res.json({ device: req.params.imei, modemType: device.modemType, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get records in time range
app.get('/devices/:imei/records/range', async (req, res) => {
    try {
        const db = getDb();
        const { from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({ error: 'Missing from or to parameter' });
        }

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);
        const records = await db.collection(collection)
            .find({
                imei: req.params.imei,
                timestamp: {
                    $gte: from,
                    $lte: to
                }
            })
            .sort({ timestamp: 1 })
            .toArray();

        res.json({
            device: req.params.imei,
            modemType: device.modemType,
            from,
            to,
            count: records.length,
            records
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ RAW DATA ============

// Get raw data for a device
app.get('/devices/:imei/raw', async (req, res) => {
    try {
        const db = getDb();

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('raw', device.modemType);
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);

        const rawData = await db.collection(collection)
            .find({ imei: req.params.imei })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json({
            device: req.params.imei,
            modemType: device.modemType,
            count: rawData.length,
            data: rawData
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ STATS ============

// Get stats for a device
app.get('/devices/:imei/stats', async (req, res) => {
    try {
        const db = getDb();

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);

        const totalRecords = await db.collection(collection).countDocuments({ imei: req.params.imei });

        const lastRecord = await db.collection(collection)
            .findOne({ imei: req.params.imei }, { sort: { timestamp: -1 } });

        const firstRecord = await db.collection(collection)
            .findOne({ imei: req.params.imei }, { sort: { timestamp: 1 } });

        // Get today's record count
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayRecords = await db.collection(collection).countDocuments({
            imei: req.params.imei,
            createdAt: { $gte: today }
        });

        res.json({
            device: req.params.imei,
            modemType: device.modemType,
            vin: device.vin,
            carBrand: device.carBrand,
            carModel: device.carModel,
            plateNumber: device.plateNumber,
            totalRecords,
            todayRecords,
            firstRecord: firstRecord?.timestamp,
            lastRecord: lastRecord?.timestamp,
            lastPosition: lastRecord?.gps,
            lastIgnition: lastRecord?.ignition,
            lastSpeed: lastRecord?.gps?.speed
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ DRIVER BEHAVIOR ============

/**
 * Convert unsigned 16-bit to signed (accelerometer values)
 * FMC003 accelerometer returns mG values as unsigned 16-bit
 */
function toSigned16(val) {
    if (val === undefined || val === null) return null;
    return val > 32767 ? val - 65536 : val;
}

/**
 * Apply median filter to remove noise from accelerometer data
 * Uses a sliding window of 3 samples
 */
function medianFilter(values) {
    if (values.length < 3) return values;
    const filtered = [values[0]];
    for (let i = 1; i < values.length - 1; i++) {
        const window = [values[i - 1], values[i], values[i + 1]].sort((a, b) => a - b);
        filtered.push(window[1]); // median
    }
    filtered.push(values[values.length - 1]);
    return filtered;
}

/**
 * Calculate driver behavior score for a set of trip records
 * Based on FMC003 capabilities:
 * - Accelerometer X/Y/Z (harsh braking/acceleration/cornering)
 * - Speed (GPS)
 * - Ignition + Movement (idle detection)
 *
 * Returns null if insufficient accelerometer data
 */
function calculateDriverBehavior(tripRecords) {
    // Filter records that have accelerometer data
    const accelRecords = tripRecords.filter(r =>
        r.accelerometerX !== undefined &&
        r.accelerometerY !== undefined
    );

    // Need minimum 5 records with accelerometer for reliable analysis
    if (accelRecords.length < 5) {
        return null;
    }

    // ============ THRESHOLDS ============
    // Based on industry standards for fleet management:
    // - Hard brake/accel: > 0.35g sustained for 200ms+
    // - Harsh cornering: > 0.3g lateral at speed > 20 km/h
    // FMC003 reports in mG, so 350 mG = 0.35g
    const HARD_BRAKE_THRESHOLD = 150;      // mG deviation (negative X = braking)
    const HARD_ACCEL_THRESHOLD = 200;      // mG deviation (positive X = acceleration)
    const HARSH_CORNER_THRESHOLD = 150;    // mG lateral deviation
    const MIN_SPEED_FOR_EVENTS = 10;       // km/h - ignore events below this speed
    const MIN_SPEED_FOR_CORNERING = 20;    // km/h - cornering needs higher speed
    const IDLE_THRESHOLD_SECONDS = 300;    // 5 minutes of idle = penalty
    const EVENT_COOLDOWN_MS = 2000;        // 2 seconds between same event type

    // ============ STEP 1: Calculate baseline from stationary records ============
    const stationaryRecords = tripRecords.filter(r => {
        const speed = r.obdVehicleSpeed || r.gps?.speed || 0;
        return speed < 3 && r.accelerometerX !== undefined && r.accelerometerY !== undefined;
    });

    let baselineX = 0;
    let baselineY = 0;

    if (stationaryRecords.length >= 3) {
        // Use median of stationary records for robust baseline
        const xValues = stationaryRecords.map(r => toSigned16(r.accelerometerX)).sort((a, b) => a - b);
        const yValues = stationaryRecords.map(r => toSigned16(r.accelerometerY)).sort((a, b) => a - b);
        const midIdx = Math.floor(xValues.length / 2);
        baselineX = xValues[midIdx];
        baselineY = yValues[midIdx];
    } else {
        // Fallback: average of first few readings
        const firstRecords = accelRecords.slice(0, 5);
        baselineX = Math.round(firstRecords.reduce((sum, r) => sum + toSigned16(r.accelerometerX), 0) / firstRecords.length);
        baselineY = Math.round(firstRecords.reduce((sum, r) => sum + toSigned16(r.accelerometerY), 0) / firstRecords.length);
    }

    // ============ STEP 2: Prepare filtered accelerometer data ============
    // Extract and convert accelerometer values
    const xRaw = accelRecords.map(r => toSigned16(r.accelerometerX) - baselineX);
    const yRaw = accelRecords.map(r => toSigned16(r.accelerometerY) - baselineY);

    // Apply median filter to reduce noise
    const xFiltered = medianFilter(xRaw);
    const yFiltered = medianFilter(yRaw);

    // ============ STEP 3: Detect events ============
    let hardBraking = 0;
    let hardAcceleration = 0;
    let harshCornering = 0;
    let idleSeconds = 0;
    let maxSpeed = 0;
    let maxRpm = 0;

    // Cooldown tracking
    let lastBrakeTime = null;
    let lastAccelTime = null;
    let lastCornerTime = null;

    let prevRecord = null;

    for (let i = 0; i < tripRecords.length; i++) {
        const r = tripRecords[i];
        const speed = r.obdVehicleSpeed || r.gps?.speed || 0;
        const rpm = r.obdEngineRpm || 0;
        const currentTime = new Date(r.timestamp).getTime();
        const ignition = r.ignition || 0;
        const movement = r.movement || 0;

        // Track max values
        if (speed > maxSpeed) maxSpeed = speed;
        if (rpm > maxRpm) maxRpm = rpm;

        // Calculate time delta
        let deltaSeconds = 5;
        if (prevRecord) {
            const timeDiff = (new Date(r.timestamp) - new Date(prevRecord.timestamp)) / 1000;
            deltaSeconds = Math.min(Math.max(1, timeDiff), 60); // Cap between 1-60s
        }

        // ============ IDLE DETECTION ============
        // Ignition ON + Speed = 0 + not moving
        if (ignition === 1 && speed < 3 && movement === 0) {
            idleSeconds += deltaSeconds;
        }

        // ============ ACCELEROMETER EVENTS ============
        // Find corresponding filtered accelerometer record
        const accelIdx = accelRecords.findIndex(ar => ar.timestamp === r.timestamp);

        if (accelIdx >= 0 && speed >= MIN_SPEED_FOR_EVENTS) {
            const devX = xFiltered[accelIdx];
            const devY = yFiltered[accelIdx];

            // Hard braking (large negative X)
            if (devX < -HARD_BRAKE_THRESHOLD) {
                if (!lastBrakeTime || (currentTime - lastBrakeTime) > EVENT_COOLDOWN_MS) {
                    hardBraking++;
                    lastBrakeTime = currentTime;
                }
            }

            // Hard acceleration (large positive X)
            if (devX > HARD_ACCEL_THRESHOLD) {
                if (!lastAccelTime || (currentTime - lastAccelTime) > EVENT_COOLDOWN_MS) {
                    hardAcceleration++;
                    lastAccelTime = currentTime;
                }
            }

            // Harsh cornering (large Y deviation at sufficient speed)
            if (Math.abs(devY) > HARSH_CORNER_THRESHOLD && speed >= MIN_SPEED_FOR_CORNERING) {
                if (!lastCornerTime || (currentTime - lastCornerTime) > EVENT_COOLDOWN_MS) {
                    harshCornering++;
                    lastCornerTime = currentTime;
                }
            }
        }

        prevRecord = r;
    }

    // ============ STEP 4: Calculate scores ============
    // Two separate scores:
    // - driverScore: behavior (braking, acceleration, cornering)
    // - efficiencyScore: fleet efficiency (idle time)

    // Calculate trip duration
    const tripStart = new Date(tripRecords[0].timestamp);
    const tripEnd = new Date(tripRecords[tripRecords.length - 1].timestamp);
    const tripDurationMinutes = Math.round((tripEnd - tripStart) / 60000);

    // Normalization factor CLAMPED between 1-6 (max normalization = 60 min)
    // Beyond 1 hour, behavior must count fully
    const durationFactor = Math.min(6, Math.max(1, tripDurationMinutes / 10));

    // === DRIVER SCORE (behavior only) ===
    // Raw penalties with CAPS per category
    const rawPenalties = {
        hardBraking: Math.min(25, hardBraking * 4),           // Cap 25, -4 per event
        hardAcceleration: Math.min(20, hardAcceleration * 2), // Cap 20, -2 per event
        harshCornering: Math.min(15, harshCornering * 3)      // Cap 15, -3 per event
    };

    const totalRawPenalty = Object.values(rawPenalties).reduce((a, b) => a + b, 0);

    // Severe events = braking + cornering (most dangerous)
    const severeEvents = hardBraking + harshCornering;

    // Normalized penalty with MINIMUM FLOOR for severe events
    // Ensures at least 3 points penalty if any severe event occurred
    const normalizedPenalty = Math.max(
        totalRawPenalty / durationFactor,
        severeEvents > 0 ? 3 : 0
    );

    // Final driver score clamped 0-100
    const driverScore = Math.max(0, Math.min(100, Math.round(100 - normalizedPenalty)));

    // === EFFICIENCY SCORE (idle time) ===
    // Separate from driver behavior - this is fleet efficiency metric
    const idleMinutes = Math.round(idleSeconds / 60);
    const idlePenalty = Math.min(30, Math.floor(idleMinutes / 5) * 2); // -2 per 5 min idle, cap 30
    const efficiencyScore = Math.max(0, Math.min(100, 100 - idlePenalty));

    // ============ CONFIDENCE CALCULATION ============
    // Determines how reliable the score is based on data quality
    const confidenceReasons = [];

    // Check GNSS quality (from first/last records with GPS)
    const gpsRecords = tripRecords.filter(r => r.gps?.satellites > 0);
    const avgSatellites = gpsRecords.length > 0
        ? gpsRecords.reduce((sum, r) => sum + r.gps.satellites, 0) / gpsRecords.length
        : 0;

    if (avgSatellites < 3) {
        confidenceReasons.push('poor_gnss');
    }

    // Check if we have enough accelerometer data
    const accelCoverage = accelRecords.length / tripRecords.length;
    if (accelCoverage < 0.3) {
        confidenceReasons.push('low_accel_coverage');
    }

    // Check trip duration (very short trips have less reliable data)
    if (tripDurationMinutes < 5) {
        confidenceReasons.push('short_trip');
    }

    // Check if distance was estimated (odometer didn't update)
    const startOdo = tripRecords[0]?.totalOdometer;
    const endOdo = tripRecords[tripRecords.length - 1]?.totalOdometer;
    if (startOdo && endOdo && startOdo === endOdo) {
        confidenceReasons.push('distance_estimated');
    }

    // Determine confidence level
    // Note: short_trip doesn't affect score, only perfectTrip eligibility
    const scoreAffectingReasons = confidenceReasons.filter(r => r !== 'short_trip');
    let confidenceLevel = 'high';
    if (scoreAffectingReasons.length >= 2) {
        confidenceLevel = 'low';
    } else if (scoreAffectingReasons.length === 1) {
        confidenceLevel = 'medium';
    }

    // ============ PERFECT TRIP DETERMINATION ============
    // Perfect trip requires: no penalties + high confidence + minimum duration
    const perfectTrip = totalRawPenalty === 0 &&
                        confidenceLevel === 'high' &&
                        tripDurationMinutes >= 5;

    // Apply confidence damping (low confidence caps score at 95)
    let finalDriverScore = driverScore;
    if (confidenceLevel === 'low' && driverScore > 95) {
        finalDriverScore = 95;
    }

    return {
        score: finalDriverScore,  // Main score for backward compatibility
        driverScore: finalDriverScore,
        efficiencyScore,
        perfectTrip,
        confidence: {
            level: confidenceLevel,
            reasons: confidenceReasons,
            accelCoverage: Math.round(accelCoverage * 100),
            avgSatellites: Math.round(avgSatellites * 10) / 10
        },
        events: {
            hardBraking,
            hardAcceleration,
            harshCornering,
            idleMinutes
        },
        penalties: {
            raw: rawPenalties,
            totalRaw: totalRawPenalty,
            normalized: Math.round(normalizedPenalty * 10) / 10,
            durationFactor: Math.round(durationFactor * 10) / 10,
            severeEvents,
            idlePenalty
        },
        maxSpeed,
        maxRpm,
        baseline: {
            x: Math.round(baselineX),
            y: Math.round(baselineY)
        },
        analysis: {
            recordsWithAccel: accelRecords.length,
            totalRecords: tripRecords.length,
            tripDurationMinutes
        }
    };
}

// ============ TRIPS ============

// Get trips (based on ignition on/off)
app.get('/devices/:imei/trips', async (req, res) => {
    try {
        const db = getDb();

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);

        // Get all records (we need all data to calculate stats)
        const records = await db.collection(collection)
            .find({
                imei: req.params.imei,
                ignition: { $exists: true }
            })
            .sort({ timestamp: 1 })  // Sort ascending for easier processing
            .toArray();

        // Group into trips based on engine running (RPM > 0 or ignition with timeout)
        const trips = [];
        let currentTrip = null;
        let tripRecords = [];
        let lastEngineOnTime = null;

        // Engine is considered ON if ignition=1 OR rpm > 0
        const isEngineOn = (r) => r.ignition === 1 || (r.obdEngineRpm && r.obdEngineRpm > 0);

        for (const record of records) {
            const engineOn = isEngineOn(record);

            if (engineOn && !currentTrip) {
                // Trip starts
                currentTrip = {
                    startTime: record.timestamp,
                    startOdometer: record.totalOdometer
                };
                tripRecords = [record];
                lastEngineOnTime = new Date(record.timestamp);
            } else if (engineOn && currentTrip) {
                // During trip - collect record
                tripRecords.push(record);
                lastEngineOnTime = new Date(record.timestamp);
            } else if (!engineOn && currentTrip) {
                // Check if engine has been off for more than 60 seconds
                const timeSinceLastOn = new Date(record.timestamp) - lastEngineOnTime;

                if (timeSinceLastOn > 60000) {
                    // Trip ends - use the last record where engine was on
                    const lastOnRecord = tripRecords[tripRecords.length - 1];

                    currentTrip.endTime = lastOnRecord.timestamp;
                    currentTrip.endOdometer = lastOnRecord.totalOdometer;

                    // Calculate distance in meters and km
                    if (currentTrip.startOdometer && currentTrip.endOdometer) {
                        currentTrip.distanceMeters = currentTrip.endOdometer - currentTrip.startOdometer;
                        currentTrip.distanceKm = Math.round(currentTrip.distanceMeters / 100) / 10;
                    }

                    // If odometer didn't change but we have speed data, estimate distance from speed × time
                    if (currentTrip.distanceMeters === 0 || !currentTrip.distanceMeters) {
                        let estimatedDistanceMeters = 0;
                        for (let i = 1; i < tripRecords.length; i++) {
                            const prevTime = new Date(tripRecords[i - 1].timestamp);
                            const currTime = new Date(tripRecords[i].timestamp);
                            const deltaSeconds = (currTime - prevTime) / 1000;
                            const speed = tripRecords[i - 1].obdVehicleSpeed || tripRecords[i - 1].gps?.speed || 0;
                            // speed is km/h, convert to m/s then multiply by time
                            estimatedDistanceMeters += (speed / 3.6) * deltaSeconds;
                        }
                        if (estimatedDistanceMeters > 0) {
                            currentTrip.distanceMeters = Math.round(estimatedDistanceMeters);
                            currentTrip.distanceKm = Math.round(estimatedDistanceMeters / 100) / 10;
                            currentTrip.distanceEstimated = true;
                        }
                    }

                    // Calculate duration
                    const startDate = new Date(currentTrip.startTime);
                    const endDate = new Date(currentTrip.endTime);
                    const durationMs = endDate - startDate;
                    const totalMinutes = Math.round(durationMs / 60000);
                    const hours = Math.floor(totalMinutes / 60);
                    const minutes = totalMinutes % 60;
                    currentTrip.duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                    currentTrip.durationMinutes = totalMinutes;

                    // Calculate average speed from distance/time (includes stops)
                    if (currentTrip.distanceMeters && totalMinutes > 0) {
                        const durationHours = totalMinutes / 60;
                        currentTrip.avgSpeedTotal = Math.round(currentTrip.distanceKm / durationHours * 10) / 10;
                    }

                    // Find max speed and calculate avg from OBD/GPS records (only when moving)
                    let maxSpeed = 0;
                    let speedSum = 0;
                    let speedCount = 0;

                    for (const r of tripRecords) {
                        const speed = r.obdVehicleSpeed || r.gps?.speed || 0;
                        if (speed > 0) {
                            speedSum += speed;
                            speedCount++;
                            if (speed > maxSpeed) maxSpeed = speed;
                        }
                    }

                    currentTrip.maxSpeed = maxSpeed;
                    if (speedCount > 0) {
                        currentTrip.avgSpeedMoving = Math.round(speedSum / speedCount * 10) / 10;
                    }

                    // Calculate fuel consumption from GPS (only for trips > 2km and > 5 minutes)
                    const startFuel = tripRecords[0].fuelUsedGps;
                    const endFuel = tripRecords[tripRecords.length - 1].fuelUsedGps;
                    if (startFuel !== undefined && endFuel !== undefined) {
                        const fuelUsedMl = endFuel - startFuel;

                        if (currentTrip.distanceKm >= 2 && currentTrip.durationMinutes >= 5 && fuelUsedMl > 0) {
                            currentTrip.fuelUsedMl = fuelUsedMl;
                            currentTrip.fuelUsedLiters = Math.round(fuelUsedMl / 10) / 100;
                            currentTrip.fuelPer100km = Math.round((currentTrip.fuelUsedLiters / currentTrip.distanceKm) * 100 * 10) / 10;
                            currentTrip.fuelFromGps = true; // Flag: GPS-estimated, not OBD real
                        }
                    }

                    // Find first/last position with valid GPS (satellites > 0)
                    const validGpsRecords = tripRecords.filter(r => r.gps?.satellites > 0);
                    if (validGpsRecords.length > 0) {
                        currentTrip.startPosition = validGpsRecords[0].gps;
                        currentTrip.endPosition = validGpsRecords[validGpsRecords.length - 1].gps;
                    } else {
                        currentTrip.startPosition = tripRecords[0].gps;
                        currentTrip.endPosition = tripRecords[tripRecords.length - 1].gps;
                    }

                    // Calculate driver behavior (returns null if insufficient accelerometer data)
                    const driverBehavior = calculateDriverBehavior(tripRecords);
                    if (driverBehavior) {
                        currentTrip.driverBehavior = driverBehavior;
                    }

                    // Only add trip if it has meaningful data (duration >= 2 min or distance > 100m)
                    if (currentTrip.durationMinutes >= 2 || currentTrip.distanceMeters > 100) {
                        trips.push(currentTrip);
                    }
                    currentTrip = null;
                    tripRecords = [];
                }
                // else: engine briefly off, keep collecting records
            }
        }

        // Sort trips by start time descending (most recent first)
        trips.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        res.json({
            device: req.params.imei,
            count: Math.min(trips.length, limit),
            trips: trips.slice(0, limit)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ DAILY STATS ============

// Get daily statistics for a device
app.get('/devices/:imei/daily/:date?', async (req, res) => {
    try {
        const db = getDb();

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);

        // Parse date or use today
        let targetDate;
        if (req.params.date) {
            targetDate = new Date(req.params.date);
        } else {
            targetDate = new Date();
        }
        targetDate.setHours(0, 0, 0, 0);

        const nextDay = new Date(targetDate);
        nextDay.setDate(nextDay.getDate() + 1);

        const dateStr = targetDate.toISOString().split('T')[0];

        // Get all records for the day
        const records = await db.collection(collection)
            .find({
                imei: req.params.imei,
                timestamp: {
                    $gte: targetDate.toISOString(),
                    $lt: nextDay.toISOString()
                }
            })
            .sort({ timestamp: 1 })
            .toArray();

        if (records.length === 0) {
            return res.json({
                device: req.params.imei,
                date: dateStr,
                message: 'No data for this day',
                recordCount: 0
            });
        }

        // Calculate distance (odometer difference)
        const firstOdometer = records[0].totalOdometer;
        const lastOdometer = records[records.length - 1].totalOdometer;
        const distanceMeters = lastOdometer - firstOdometer;
        const distanceKm = Math.round(distanceMeters / 100) / 10;

        // Calculate fuel consumption (only if distance > 2km)
        const firstFuel = records[0].fuelUsedGps;
        const lastFuel = records[records.length - 1].fuelUsedGps;
        let fuelUsedMl = null;
        let fuelUsedLiters = null;
        let fuelPer100km = null;
        let fuelEstimated = false;
        if (firstFuel !== undefined && lastFuel !== undefined && distanceKm >= 2) {
            fuelUsedMl = lastFuel - firstFuel;
            if (fuelUsedMl > 0) {
                fuelUsedLiters = Math.round(fuelUsedMl / 10) / 100;
                fuelPer100km = Math.round((fuelUsedLiters / distanceKm) * 100 * 10) / 10;
                fuelEstimated = true; // GPS-estimated, not OBD
            }
        }

        // Calculate averages
        let batteryVoltageOnSum = 0, batteryVoltageOnCount = 0;
        let batteryVoltageOffSum = 0, batteryVoltageOffCount = 0;
        let externalVoltageOnSum = 0, externalVoltageOnCount = 0;
        let externalVoltageOffSum = 0, externalVoltageOffCount = 0;
        let minExternalVoltageOn = Infinity, maxExternalVoltageOn = 0;
        let minExternalVoltageOff = Infinity, maxExternalVoltageOff = 0;
        let speedSum = 0, speedCount = 0;
        let maxSpeed = 0;
        let engineRpmSum = 0, engineRpmCount = 0;
        let maxRpm = 0;
        let coolantTempSum = 0, coolantTempCount = 0;
        let maxCoolantTemp = 0;
        let engineLoadSum = 0, engineLoadCount = 0;

        let ignitionOnTime = 0;
        let lastIgnitionOn = null;
        let tripCount = 0;
        let inTrip = false;
        let lastEngineOnTime = null;

        for (const r of records) {
            // Engine ON = alternator charging (ignition + rpm or movement or speed)
            const isEngineOn = r.ignition === 1 && (r.movement === 1 || r.obdVehicleSpeed > 0 || r.obdEngineRpm > 0);

            // Battery voltage (mV) - separate by engine state
            if (r.batteryVoltage) {
                if (isEngineOn) {
                    batteryVoltageOnSum += r.batteryVoltage;
                    batteryVoltageOnCount++;
                } else {
                    batteryVoltageOffSum += r.batteryVoltage;
                    batteryVoltageOffCount++;
                }
            }

            // External voltage (mV) - separate by engine state
            if (r.externalVoltage) {
                if (isEngineOn) {
                    externalVoltageOnSum += r.externalVoltage;
                    externalVoltageOnCount++;
                    if (r.externalVoltage < minExternalVoltageOn) minExternalVoltageOn = r.externalVoltage;
                    if (r.externalVoltage > maxExternalVoltageOn) maxExternalVoltageOn = r.externalVoltage;
                } else {
                    externalVoltageOffSum += r.externalVoltage;
                    externalVoltageOffCount++;
                    if (r.externalVoltage < minExternalVoltageOff) minExternalVoltageOff = r.externalVoltage;
                    if (r.externalVoltage > maxExternalVoltageOff) maxExternalVoltageOff = r.externalVoltage;
                }
            }

            // Speed (OBD or GPS)
            const speed = r.obdVehicleSpeed || r.gps?.speed || 0;
            if (speed > 0) {
                speedSum += speed;
                speedCount++;
                if (speed > maxSpeed) maxSpeed = speed;
            }

            // Engine RPM
            if (r.obdEngineRpm) {
                engineRpmSum += r.obdEngineRpm;
                engineRpmCount++;
                if (r.obdEngineRpm > maxRpm) maxRpm = r.obdEngineRpm;
            }

            // Coolant temperature
            if (r.obdCoolantTemp) {
                coolantTempSum += r.obdCoolantTemp;
                coolantTempCount++;
                if (r.obdCoolantTemp > maxCoolantTemp) maxCoolantTemp = r.obdCoolantTemp;
            }

            // Engine load
            if (r.obdEngineLoad) {
                engineLoadSum += r.obdEngineLoad;
                engineLoadCount++;
            }

            // Trip counting with engine-based logic (same as trips endpoint)
            const engineOn = r.ignition === 1 || (r.obdEngineRpm && r.obdEngineRpm > 0);

            if (engineOn && !inTrip) {
                // New trip starts
                inTrip = true;
                tripCount++;
                lastEngineOnTime = new Date(r.timestamp);
                if (!lastIgnitionOn) lastIgnitionOn = new Date(r.timestamp);
            } else if (engineOn && inTrip) {
                // Still in trip
                lastEngineOnTime = new Date(r.timestamp);
            } else if (!engineOn && inTrip) {
                // Check if engine has been off for > 60 seconds
                const timeSinceLastOn = new Date(r.timestamp) - lastEngineOnTime;
                if (timeSinceLastOn > 60000) {
                    // Trip ends
                    inTrip = false;
                    if (lastIgnitionOn) {
                        ignitionOnTime += lastEngineOnTime - lastIgnitionOn;
                        lastIgnitionOn = null;
                    }
                }
            }
        }

        // If still in trip at end of day, add remaining time
        if (inTrip && lastIgnitionOn && lastEngineOnTime) {
            ignitionOnTime += lastEngineOnTime - lastIgnitionOn;
        }

        const drivingMinutes = Math.round(ignitionOnTime / 60000);
        const drivingHours = Math.floor(drivingMinutes / 60);
        const drivingMins = drivingMinutes % 60;

        res.json({
            device: req.params.imei,
            date: dateStr,
            recordCount: records.length,
            tripCount,

            // Distance & Fuel
            distance: {
                meters: distanceMeters,
                km: distanceKm
            },
            fuel: {
                usedMl: fuelUsedMl,
                usedLiters: fuelUsedLiters,
                per100km: fuelPer100km,
                estimated: fuelEstimated
            },

            // Time
            drivingTime: {
                minutes: drivingMinutes,
                formatted: drivingHours > 0 ? `${drivingHours}h ${drivingMins}m` : `${drivingMins}m`
            },

            // Speed
            speed: {
                max: maxSpeed,
                avg: speedCount > 0 ? Math.round(speedSum / speedCount * 10) / 10 : 0
            },

            // Voltage - separated by ignition state
            voltage: {
                ignitionOn: {
                    batteryAvg: batteryVoltageOnCount > 0 ? Math.round(batteryVoltageOnSum / batteryVoltageOnCount) / 1000 : null,
                    externalAvg: externalVoltageOnCount > 0 ? Math.round(externalVoltageOnSum / externalVoltageOnCount) / 1000 : null,
                    externalMin: externalVoltageOnCount > 0 ? Math.round(minExternalVoltageOn) / 1000 : null,
                    externalMax: externalVoltageOnCount > 0 ? Math.round(maxExternalVoltageOn) / 1000 : null
                },
                ignitionOff: {
                    batteryAvg: batteryVoltageOffCount > 0 ? Math.round(batteryVoltageOffSum / batteryVoltageOffCount) / 1000 : null,
                    externalAvg: externalVoltageOffCount > 0 ? Math.round(externalVoltageOffSum / externalVoltageOffCount) / 1000 : null,
                    externalMin: externalVoltageOffCount > 0 ? Math.round(minExternalVoltageOff) / 1000 : null,
                    externalMax: externalVoltageOffCount > 0 ? Math.round(maxExternalVoltageOff) / 1000 : null
                }
            },

            // Engine (OBD)
            engine: {
                rpmMax: maxRpm,
                rpmAvg: engineRpmCount > 0 ? Math.round(engineRpmSum / engineRpmCount) : 0,
                coolantTempMax: maxCoolantTemp,
                coolantTempAvg: coolantTempCount > 0 ? Math.round(coolantTempSum / coolantTempCount) : 0,
                loadAvg: engineLoadCount > 0 ? Math.round(engineLoadSum / engineLoadCount) : 0
            },

            // First and last position
            firstPosition: records[0].gps,
            lastPosition: records[records.length - 1].gps,
            firstTimestamp: records[0].timestamp,
            lastTimestamp: records[records.length - 1].timestamp
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get daily stats for date range
app.get('/devices/:imei/daily-range', async (req, res) => {
    try {
        const db = getDb();
        const { from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({ error: 'Missing from or to parameter (format: YYYY-MM-DD)' });
        }

        const device = await db.collection('devices').findOne({ imei: req.params.imei });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const collection = getCollectionName('records', device.modemType);

        // Get aggregated daily stats
        const startDate = new Date(from);
        const endDate = new Date(to);
        endDate.setDate(endDate.getDate() + 1);

        const pipeline = [
            {
                $match: {
                    imei: req.params.imei,
                    timestamp: { $gte: startDate.toISOString(), $lt: endDate.toISOString() }
                }
            },
            {
                $addFields: {
                    date: { $substr: ['$timestamp', 0, 10] }
                }
            },
            {
                $group: {
                    _id: '$date',
                    recordCount: { $sum: 1 },
                    firstOdometer: { $first: '$totalOdometer' },
                    lastOdometer: { $last: '$totalOdometer' },
                    firstFuel: { $first: '$fuelUsedGps' },
                    lastFuel: { $last: '$fuelUsedGps' },
                    maxSpeed: { $max: '$obdVehicleSpeed' },
                    avgSpeed: { $avg: '$obdVehicleSpeed' },
                    maxRpm: { $max: '$obdEngineRpm' },
                    avgRpm: { $avg: '$obdEngineRpm' },
                    maxCoolantTemp: { $max: '$obdCoolantTemp' },
                    avgCoolantTemp: { $avg: '$obdCoolantTemp' },
                    avgEngineLoad: { $avg: '$obdEngineLoad' },
                    records: { $push: { ignition: '$ignition', movement: '$movement', obdVehicleSpeed: '$obdVehicleSpeed', obdEngineRpm: '$obdEngineRpm', batteryVoltage: '$batteryVoltage', externalVoltage: '$externalVoltage' } }
                }
            },
            { $sort: { _id: 1 } }
        ];

        const results = await db.collection(collection).aggregate(pipeline).toArray();

        const days = results.map(r => {
            const distanceMeters = (r.lastOdometer || 0) - (r.firstOdometer || 0);
            const fuelUsedMl = (r.lastFuel || 0) - (r.firstFuel || 0);
            const distanceKm = Math.round(distanceMeters / 100) / 10;
            const fuelUsedLiters = Math.round(fuelUsedMl / 10) / 100;

            // Calculate voltage by engine state and count trips
            let battOnSum = 0, battOnCnt = 0, battOffSum = 0, battOffCnt = 0;
            let extOnSum = 0, extOnCnt = 0, extOffSum = 0, extOffCnt = 0;
            let extOnMin = Infinity, extOnMax = 0, extOffMin = Infinity, extOffMax = 0;
            let tripCount = 0;
            let inTrip = false;
            let lastEngineOnIdx = -1;

            for (let i = 0; i < r.records.length; i++) {
                const rec = r.records[i];
                // Engine ON = ignition + rpm or movement or speed
                const engineOn = rec.ignition === 1 || (rec.obdEngineRpm && rec.obdEngineRpm > 0);

                if (engineOn && !inTrip) {
                    inTrip = true;
                    tripCount++;
                    lastEngineOnIdx = i;
                } else if (engineOn && inTrip) {
                    lastEngineOnIdx = i;
                } else if (!engineOn && inTrip && lastEngineOnIdx >= 0) {
                    // Simplified: count records since last engine on (approximate 60s timeout)
                    // Since we don't have timestamps in aggregation, use record count (~5s intervals = 12 records for 60s)
                    if (i - lastEngineOnIdx > 12) {
                        inTrip = false;
                    }
                }

                // Engine ON for voltage = alternator charging
                const isEngineOn = rec.ignition === 1 && (rec.movement === 1 || rec.obdVehicleSpeed > 0 || rec.obdEngineRpm > 0);

                if (isEngineOn) {
                    if (rec.batteryVoltage) { battOnSum += rec.batteryVoltage; battOnCnt++; }
                    if (rec.externalVoltage) {
                        extOnSum += rec.externalVoltage; extOnCnt++;
                        if (rec.externalVoltage < extOnMin) extOnMin = rec.externalVoltage;
                        if (rec.externalVoltage > extOnMax) extOnMax = rec.externalVoltage;
                    }
                } else {
                    if (rec.batteryVoltage) { battOffSum += rec.batteryVoltage; battOffCnt++; }
                    if (rec.externalVoltage) {
                        extOffSum += rec.externalVoltage; extOffCnt++;
                        if (rec.externalVoltage < extOffMin) extOffMin = rec.externalVoltage;
                        if (rec.externalVoltage > extOffMax) extOffMax = rec.externalVoltage;
                    }
                }
            }

            return {
                date: r._id,
                recordCount: r.recordCount,
                tripCount,
                distanceKm,
                fuelUsedLiters,
                fuelPer100km: distanceKm > 0 ? Math.round((fuelUsedLiters / distanceKm) * 100 * 10) / 10 : null,
                speed: {
                    max: r.maxSpeed || 0,
                    avg: r.avgSpeed ? Math.round(r.avgSpeed * 10) / 10 : 0
                },
                engine: {
                    rpmMax: r.maxRpm || 0,
                    rpmAvg: r.avgRpm ? Math.round(r.avgRpm) : 0,
                    coolantTempMax: r.maxCoolantTemp || 0,
                    coolantTempAvg: r.avgCoolantTemp ? Math.round(r.avgCoolantTemp) : 0,
                    loadAvg: r.avgEngineLoad ? Math.round(r.avgEngineLoad) : 0
                },
                voltage: {
                    ignitionOn: {
                        batteryAvg: battOnCnt > 0 ? Math.round(battOnSum / battOnCnt) / 1000 : null,
                        externalAvg: extOnCnt > 0 ? Math.round(extOnSum / extOnCnt) / 1000 : null,
                        externalMin: extOnCnt > 0 ? Math.round(extOnMin) / 1000 : null,
                        externalMax: extOnCnt > 0 ? Math.round(extOnMax) / 1000 : null
                    },
                    ignitionOff: {
                        batteryAvg: battOffCnt > 0 ? Math.round(battOffSum / battOffCnt) / 1000 : null,
                        externalAvg: extOffCnt > 0 ? Math.round(extOffSum / extOffCnt) / 1000 : null,
                        externalMin: extOffCnt > 0 ? Math.round(extOffMin) / 1000 : null,
                        externalMax: extOffCnt > 0 ? Math.round(extOffMax) / 1000 : null
                    }
                }
            };
        });

        res.json({
            device: req.params.imei,
            from,
            to,
            days
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function startAPI() {
    app.listen(API_PORT, '0.0.0.0', () => {
        console.log(`API server listening on port ${API_PORT}`);
    });
}

module.exports = { startAPI, app };
