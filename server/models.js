const { getDb } = require('./db');

/**
 * Get collection name based on device type
 */
function getCollectionName(prefix, modemType) {
    const type = (modemType || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${prefix}_${type}`;
}

/**
 * Save raw telemetry data to device-specific collection
 */
async function saveRawData(imei, vin, rawHex, modemType = 'FMC003') {
    const db = getDb();
    if (!db) return null;

    const collection = getCollectionName('raw', modemType);
    const doc = {
        imei,
        vin: vin || null,
        modemType,
        rawHex,
        timestamp: new Date()
    };

    try {
        const result = await db.collection(collection).insertOne(doc);
        return result.insertedId;
    } catch (err) {
        console.error('Error saving raw data:', err);
        return null;
    }
}

/**
 * Save normalized/parsed telemetry record to device-specific collection
 */
async function saveRecord(imei, vin, modemType, record) {
    const db = getDb();
    if (!db) return null;

    const collection = getCollectionName('records', modemType);
    const doc = buildRecordDoc(imei, vin, modemType, record);

    try {
        const result = await db.collection(collection).insertOne(doc);
        return result.insertedId;
    } catch (err) {
        console.error('Error saving record:', err);
        return null;
    }
}

/**
 * Save multiple records at once to device-specific collection
 */
async function saveRecords(imei, vin, modemType, records) {
    const db = getDb();
    if (!db) return null;

    const collection = getCollectionName('records', modemType);
    const docs = records.map(record => buildRecordDoc(imei, vin, modemType, record));

    try {
        const result = await db.collection(collection).insertMany(docs);
        return result.insertedIds;
    } catch (err) {
        console.error('Error saving records:', err);
        return null;
    }
}

/**
 * Build record document with all IO elements as named fields
 */
function buildRecordDoc(imei, vin, modemType, record) {
    const doc = {
        imei,
        vin: vin || null,
        modemType,
        timestamp: record.timestamp,
        priority: record.priority,

        // GPS data
        gps: {
            longitude: record.gps.longitude,
            latitude: record.gps.latitude,
            altitude: record.gps.altitude,
            angle: record.gps.angle,
            satellites: record.gps.satellites,
            speed: record.gps.speed
        },

        // IO metadata
        eventIoId: record.io.eventIoId,
        ioTotalCount: record.io.totalCount,

        // All IO elements as raw array (for flexibility)
        ioElements: record.io.elements.map(e => ({
            id: e.id,
            name: e.name,
            value: e.value,
            size: e.size
        })),

        createdAt: new Date()
    };

    // Add named fields for common/important IO elements (FMC003)
    for (const elem of record.io.elements) {
        const fieldName = ioIdToFieldName(elem.id);
        if (fieldName) {
            doc[fieldName] = elem.value;
        }
    }

    return doc;
}

/**
 * Map IO IDs to MongoDB field names (FMC003 specific)
 */
function ioIdToFieldName(id) {
    const fieldMap = {
        // Core telemetry
        12: 'fuelUsedGps',
        13: 'fuelRateGps',
        16: 'totalOdometer',
        21: 'gsmSignal',
        24: 'speedIO',
        66: 'externalVoltage',
        67: 'batteryVoltage',
        68: 'batteryCurrent',
        69: 'gnssStatus',
        113: 'batteryLevel',
        181: 'gnssPdop',
        182: 'gnssHdop',
        199: 'tripOdometer',
        200: 'sleepMode',
        205: 'gsmCellId',
        206: 'gsmAreaCode',
        237: 'networkType',
        239: 'ignition',
        240: 'movement',
        241: 'gsmOperator',
        256: 'vin',

        // OBD parameters
        30: 'obdDtcCount',
        31: 'obdEngineLoad',
        32: 'obdCoolantTemp',
        33: 'obdShortFuelTrim',
        34: 'obdFuelPressure',
        35: 'obdIntakeMap',
        36: 'obdEngineRpm',
        37: 'obdVehicleSpeed',
        38: 'obdTimingAdvance',
        39: 'obdIntakeAirTemp',
        40: 'obdMaf',
        41: 'obdThrottlePosition',
        42: 'obdRuntimeSinceStart',
        43: 'obdDistanceWithMil',
        48: 'obdFuelLevel',
        49: 'obdDistanceSinceCleared',
        50: 'obdBarometricPressure',
        51: 'obdControlModuleVoltage',
        53: 'obdAmbientAirTemp',
        58: 'obdEngineOilTemp',
        60: 'obdFuelRate',

        // OBD Totals
        389: 'obdTotalMileage',
        390: 'obdFuelLevelInput',

        // Driver behavior
        243: 'greenDrivingDuration',
        253: 'greenDrivingValue',
        246: 'towingDetection',
        247: 'crashDetection',
        249: 'jammingDetection',
        250: 'tripEvent',
        251: 'idlingEvent',
        252: 'unplugEvent',
        254: 'overspeedingEvent',

        // Accelerometer
        17: 'accelerometerX',
        18: 'accelerometerY',
        19: 'accelerometerZ',
    };
    return fieldMap[id] || null;
}

/**
 * Register or update device in devices collection
 */
async function upsertDevice(imei, vin, modemType, extraData = {}) {
    const db = getDb();
    if (!db) return null;

    const now = new Date();
    const update = {
        $set: {
            modemType,
            lastSeen: now,
            ...extraData
        },
        $setOnInsert: {
            imei,
            createdAt: now
        }
    };

    if (vin) {
        update.$set.vin = vin;
    }

    try {
        const result = await db.collection('devices').updateOne(
            { imei },
            update,
            { upsert: true }
        );
        return result.upsertedId || imei;
    } catch (err) {
        console.error('Error upserting device:', err);
        return null;
    }
}

/**
 * Get device by IMEI
 */
async function getDevice(imei) {
    const db = getDb();
    if (!db) return null;

    try {
        return await db.collection('devices').findOne({ imei });
    } catch (err) {
        console.error('Error getting device:', err);
        return null;
    }
}

/**
 * Update device info (car brand, model, plate, etc.)
 */
async function updateDeviceInfo(imei, info) {
    const db = getDb();
    if (!db) return null;

    try {
        const result = await db.collection('devices').updateOne(
            { imei },
            { $set: { ...info, updatedAt: new Date() } }
        );
        return result.modifiedCount > 0;
    } catch (err) {
        console.error('Error updating device:', err);
        return null;
    }
}

module.exports = {
    saveRawData,
    saveRecord,
    saveRecords,
    upsertDevice,
    getDevice,
    updateDeviceInfo,
    getCollectionName
};
