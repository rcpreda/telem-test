const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
const { getCollectionName } = require('./models');

const app = express();
const API_PORT = process.env.API_PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

        // Get records with ignition changes
        const records = await db.collection(collection)
            .find({
                imei: req.params.imei,
                ignition: { $exists: true }
            })
            .sort({ timestamp: -1 })
            .limit(1000)
            .toArray();

        // Group into trips (ignition on -> ignition off)
        const trips = [];
        let currentTrip = null;

        for (let i = records.length - 1; i >= 0; i--) {
            const record = records[i];

            if (record.ignition === 1 && !currentTrip) {
                currentTrip = {
                    startTime: record.timestamp,
                    startPosition: record.gps,
                    startOdometer: record.totalOdometer
                };
            } else if (record.ignition === 0 && currentTrip) {
                currentTrip.endTime = record.timestamp;
                currentTrip.endPosition = record.gps;
                currentTrip.endOdometer = record.totalOdometer;
                if (currentTrip.startOdometer && currentTrip.endOdometer) {
                    currentTrip.distance = currentTrip.endOdometer - currentTrip.startOdometer;
                }
                trips.push(currentTrip);
                currentTrip = null;
            }
        }

        res.json({
            device: req.params.imei,
            count: Math.min(trips.length, limit),
            trips: trips.slice(0, limit)
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
