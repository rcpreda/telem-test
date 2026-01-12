const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/telem';

let client = null;
let db = null;

async function connect() {
    if (db) return db;

    try {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db();
        console.log('Connected to MongoDB');

        // Create indexes for devices collection
        await db.collection('devices').createIndex({ imei: 1 }, { unique: true });
        await db.collection('devices').createIndex({ vin: 1 });
        await db.collection('devices').createIndex({ modemType: 1 });
        await db.collection('devices').createIndex({ lastSeen: -1 });

        // Create indexes for FMC003 collections
        await createDeviceIndexes('fmc003');

        return db;
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
}

/**
 * Create indexes for device-specific collections
 */
async function createDeviceIndexes(deviceType) {
    const rawCollection = `raw_${deviceType}`;
    const recordsCollection = `records_${deviceType}`;

    // Raw collection indexes
    await db.collection(rawCollection).createIndex({ imei: 1 });
    await db.collection(rawCollection).createIndex({ vin: 1 });
    await db.collection(rawCollection).createIndex({ timestamp: -1 });

    // Records collection indexes
    await db.collection(recordsCollection).createIndex({ imei: 1 });
    await db.collection(recordsCollection).createIndex({ vin: 1 });
    await db.collection(recordsCollection).createIndex({ timestamp: -1 });
    await db.collection(recordsCollection).createIndex({ 'gps.latitude': 1, 'gps.longitude': 1 });

    // Compound indexes for common queries
    await db.collection(recordsCollection).createIndex({ imei: 1, timestamp: -1 });
    await db.collection(recordsCollection).createIndex({ vin: 1, timestamp: -1 });

    // IO element indexes for FMC003 specific fields
    await db.collection(recordsCollection).createIndex({ ignition: 1 });
    await db.collection(recordsCollection).createIndex({ movement: 1 });
    await db.collection(recordsCollection).createIndex({ obdEngineRpm: 1 });
    await db.collection(recordsCollection).createIndex({ obdVehicleSpeed: 1 });

    console.log(`Created indexes for ${deviceType} collections`);
}

/**
 * Ensure indexes exist for a new device type (call when new device connects)
 */
async function ensureDeviceIndexes(deviceType) {
    if (!db) return;
    const type = deviceType.toLowerCase();
    try {
        await createDeviceIndexes(type);
    } catch (err) {
        // Indexes might already exist, ignore
        if (!err.message.includes('already exists')) {
            console.error(`Error creating indexes for ${type}:`, err);
        }
    }
}

async function close() {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

function getDb() {
    return db;
}

module.exports = { connect, close, getDb, ensureDeviceIndexes };
