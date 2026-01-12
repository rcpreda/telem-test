/**
 * Import telemetry data from log files to local MongoDB
 * Parses raw HEX data from logs and decodes using codec8
 * Avoids duplicates by checking timestamp + imei
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { decodeCodec8 } = require('./codec8');

const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, '..', 'logs', 'server');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/telem';

// IO ID to field name mapping (same as models.js)
function ioIdToFieldName(id) {
    const fieldMap = {
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
        389: 'obdTotalMileage',
        390: 'obdFuelLevelInput',
        243: 'greenDrivingDuration',
        253: 'greenDrivingValue',
        246: 'towingDetection',
        247: 'crashDetection',
        249: 'jammingDetection',
        250: 'tripEvent',
        251: 'idlingEvent',
        252: 'unplugEvent',
        254: 'overspeedingEvent',
        17: 'accelerometerX',
        18: 'accelerometerY',
        19: 'accelerometerZ',
    };
    return fieldMap[id] || null;
}

function buildRecordDoc(imei, vin, modemType, record) {
    const doc = {
        imei,
        vin: vin || null,
        modemType,
        timestamp: record.timestamp,
        priority: record.priority,
        gps: {
            longitude: record.gps.longitude,
            latitude: record.gps.latitude,
            altitude: record.gps.altitude,
            angle: record.gps.angle,
            satellites: record.gps.satellites,
            speed: record.gps.speed
        },
        eventIoId: record.io.eventIoId,
        ioTotalCount: record.io.totalCount,
        ioElements: record.io.elements.map(e => ({
            id: e.id,
            name: e.name,
            value: e.value,
            size: e.size
        })),
        createdAt: new Date(),
        importedFromLogs: true
    };

    for (const elem of record.io.elements) {
        const fieldName = ioIdToFieldName(elem.id);
        if (fieldName) {
            doc[fieldName] = elem.value;
        }
    }

    return doc;
}

async function parseLogFile(filePath, defaultImei = null, defaultVin = null) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const packets = [];
    let currentImei = defaultImei;
    let currentVin = defaultVin;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Extract IMEI from login
        const imeiMatch = line.match(/\[LOGIN\] IMEI: (\d+)/);
        if (imeiMatch) {
            currentImei = imeiMatch[1];
            continue;
        }

        // Extract IMEI from Device registered/updated
        const deviceMatch = line.match(/\[DB\] Device registered\/updated: (\d+)/);
        if (deviceMatch) {
            currentImei = deviceMatch[1];
            continue;
        }

        // Extract VIN
        const vinMatch = line.match(/\[VIN\] Extracted: (.+)/);
        if (vinMatch) {
            currentVin = vinMatch[1];
            continue;
        }

        // Look for RECV line followed by HEX line
        if (line.includes('← RECV') && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const hexMatch = nextLine.match(/HEX: ([0-9a-fA-F]+)/);
            if (hexMatch) {
                const hexData = hexMatch[1];
                // Skip IMEI login packets (start with length 000f for 15 byte IMEI)
                if (hexData.startsWith('000f')) {
                    continue;
                }
                packets.push({
                    imei: currentImei,
                    vin: currentVin,
                    hex: hexData
                });
            }
        }
    }

    return { packets, lastImei: currentImei, lastVin: currentVin };
}

async function importToMongo(packets, db) {
    const recordsCollection = db.collection('records_fmc003');
    const rawCollection = db.collection('raw_fmc003');
    const devicesCollection = db.collection('devices');

    // Try to create unique index, but ignore if it already exists or has duplicates
    try {
        await recordsCollection.createIndex({ timestamp: 1, imei: 1 }, { unique: true });
    } catch (err) {
        console.log(`Index creation note: ${err.message}`);
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const packet of packets) {
        if (!packet.imei) {
            console.log('Skipping packet without IMEI');
            skipped++;
            continue;
        }

        try {
            const buffer = Buffer.from(packet.hex, 'hex');
            const decoded = decodeCodec8(buffer);

            if (decoded.error) {
                console.log(`Decode error: ${decoded.error}`);
                errors++;
                continue;
            }

            const modemType = 'FMC003';

            // Save raw data
            await rawCollection.insertOne({
                imei: packet.imei,
                vin: packet.vin || null,
                modemType,
                rawHex: packet.hex,
                timestamp: new Date(),
                importedFromLogs: true
            });

            // Save each record
            for (const record of decoded.avlRecords) {
                const doc = buildRecordDoc(packet.imei, packet.vin, modemType, record);

                try {
                    // Check if record already exists (by timestamp + imei)
                    const existing = await recordsCollection.findOne({
                        timestamp: doc.timestamp,
                        imei: doc.imei
                    });

                    if (existing) {
                        skipped++;
                        continue;
                    }

                    await recordsCollection.insertOne(doc);
                    imported++;
                } catch (err) {
                    if (err.code === 11000) {
                        // Duplicate key - record already exists
                        skipped++;
                    } else {
                        console.error(`Error inserting record: ${err.message}`);
                        errors++;
                    }
                }
            }

            // Update device
            await devicesCollection.updateOne(
                { imei: packet.imei },
                {
                    $set: {
                        modemType,
                        lastSeen: new Date(),
                        vin: packet.vin || undefined
                    },
                    $setOnInsert: {
                        imei: packet.imei,
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );

        } catch (err) {
            console.error(`Error processing packet: ${err.message}`);
            errors++;
        }
    }

    return { imported, skipped, errors };
}

async function main() {
    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();
    console.log('Connected to MongoDB');

    // Get all log files
    const files = fs.readdirSync(LOGS_DIR)
        .filter(f => f.endsWith('.txt'))
        .sort();

    console.log(`Found ${files.length} log files`);

    let totalImported = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Track IMEI/VIN across files (since they might span sessions)
    let lastImei = null;
    let lastVin = null;

    for (const file of files) {
        const filePath = path.join(LOGS_DIR, file);
        console.log(`\nProcessing ${file}...`);

        const { packets, lastImei: newImei, lastVin: newVin } = await parseLogFile(filePath, lastImei, lastVin);
        lastImei = newImei || lastImei;
        lastVin = newVin || lastVin;

        console.log(`  Found ${packets.length} packets (IMEI: ${lastImei || 'unknown'})`);

        if (packets.length > 0) {
            const result = await importToMongo(packets, db);
            console.log(`  Imported: ${result.imported}, Skipped (duplicates): ${result.skipped}, Errors: ${result.errors}`);
            totalImported += result.imported;
            totalSkipped += result.skipped;
            totalErrors += result.errors;
        }
    }

    console.log('\n========== SUMMARY ==========');
    console.log(`Total imported: ${totalImported}`);
    console.log(`Total skipped (duplicates): ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);

    await client.close();
    console.log('\nDone!');
}

main().catch(console.error);
