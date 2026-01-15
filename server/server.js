const net = require('net');
const fs = require('fs');
const path = require('path');
const { decodeCodec8 } = require('./codec8');
const { connect: connectDb } = require('./db');
const { saveRawData, saveRecords, upsertDevice, getDevice } = require('./models');
const { startAPI } = require('./api');

const PORT = 5027;
const HOST = '0.0.0.0';
const DATA_INTERVAL = 5000;
const LOGS_DIR = path.join(__dirname, 'logs', 'server');

// Codec to device type mapping
const CODEC_DEVICE_MAP = {
    0x08: 'FMC003',  // Codec 8
    0x8e: 'FMC003',  // Codec 8 Extended (FMC003 uses this)
    // Future codecs can be mapped to different devices
    // 0x0c: 'FMB920',  // Codec 12
    // 0x0d: 'FMB140',  // Codec 13
    // 0x0e: 'FMC150',  // Codec 14
};

if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const clients = new Map();

/**
 * Get hourly log file path
 */
function getHourlyLogFile() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    return path.join(LOGS_DIR, `${y}-${m}-${d}_${h}.txt`);
}

/**
 * Log to hourly text file
 */
function log(message) {
    const file = getHourlyLogFile();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(file, line);
    console.log(line.trim());
}

/**
 * Log received data with hex
 */
function logReceived(clientId, buffer) {
    const hex = buffer.toString('hex');
    log(`← RECV ${clientId} (${buffer.length} bytes)`);
    log(`  HEX: ${hex}`);
}

/**
 * Log sent data with hex
 */
function logSent(clientId, buffer, description) {
    const hex = buffer.toString('hex');
    log(`→ SEND ${clientId} (${buffer.length} bytes) - ${description}`);
    log(`  HEX: ${hex}`);
}

/**
 * Parse Teltonika IMEI from RAW buffer
 * Returns IMEI string or null
 */
function parseIMEI(buffer) {
    if (buffer.length < 2) return null;

    const len = buffer.readUInt16BE(0);
    if (len !== 15) return null;
    if (buffer.length < 2 + len) return null;

    return buffer.slice(2, 2 + len).toString('ascii');
}

/**
 * Extract VIN from IO elements
 */
function extractVIN(ioElements) {
    if (!ioElements || !ioElements.elements) return null;
    const vinElement = ioElements.elements.find(e => e.id === 256);
    return vinElement ? vinElement.value : null;
}

/**
 * Get device type from codec ID
 */
function getDeviceType(codecId) {
    return CODEC_DEVICE_MAP[codecId] || 'UNKNOWN';
}

/**
 * Start server
 */
async function startServer() {
    // Connect to MongoDB
    try {
        await connectDb();
        log('[DB] MongoDB connected');

        // Start API server
        startAPI();
        log('[API] API server started');
    } catch (err) {
        log(`[DB] MongoDB connection failed: ${err.message}`);
        log('[DB] Server will continue without database');
    }

    const server = net.createServer(socket => {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        log(`=== NEW CONNECTION: ${clientId} ===`);

        let deviceIMEI = null;
        let deviceVIN = null;
        let deviceType = null;

        // Timeout for unauthenticated connections (15 seconds)
        const authTimeout = setTimeout(() => {
            if (!deviceIMEI) {
                log(`[TIMEOUT] ${clientId} - No IMEI received, closing connection`);
                socket.destroy();
            }
        }, 15000);

        // Only poll for authenticated connections
        const interval = setInterval(() => {
            if (socket.writable && deviceIMEI) {
                log(`[POLL] ${clientId} (${deviceIMEI})`);
            }
        }, DATA_INTERVAL);

        clients.set(clientId, { socket, interval, authTimeout });

        socket.on('data', async buffer => {
            // Log raw received data
            logReceived(clientId, buffer);

            // IMEI login phase
            const imei = parseIMEI(buffer);
            if (imei) {
                log(`[LOGIN] IMEI: ${imei}`);
                log(`  Parsed from: length=${buffer.readUInt16BE(0)}, imei_bytes=${buffer.slice(2, 17).toString('hex')}`);

                // Check if IMEI is in whitelist (approved devices)
                const device = await getDevice(imei);
                if (!device || device.approved === false) {
                    log(`[REJECTED] IMEI not approved: ${imei}`);
                    const nack = Buffer.from([0x00]);
                    socket.write(nack);
                    logSent(clientId, nack, 'LOGIN NACK (0x00 = rejected)');
                    socket.destroy();
                    return;
                }

                deviceIMEI = imei;
                clearTimeout(authTimeout); // Clear auth timeout on successful login
                log(`[APPROVED] Device: ${device.plateNumber || device.modemType || imei}`);

                const ack = Buffer.from([0x01]);
                socket.write(ack);
                logSent(clientId, ack, 'LOGIN ACK (0x01 = accepted)');
                return;
            }

            // AVL data (Codec 8 / 8 Extended)
            const decoded = decodeCodec8(buffer);

            if (decoded.error) {
                log(`[ERROR] Decode failed: ${decoded.error}`);
                return;
            }

            // Determine device type from codec
            deviceType = getDeviceType(decoded.codecId);
            log(`[DEVICE] Type: ${deviceType} (Codec 0x${decoded.codecId.toString(16)})`);

            // Extract VIN from first record if available
            if (decoded.avlRecords.length > 0 && !deviceVIN) {
                deviceVIN = extractVIN(decoded.avlRecords[0].io);
                if (deviceVIN) {
                    log(`[VIN] Extracted: ${deviceVIN}`);
                }
            }

            // Update device registry
            upsertDevice(deviceIMEI, deviceVIN, deviceType).then(id => {
                if (id) log(`[DB] Device registered/updated: ${deviceIMEI}`);
            });

            // Save raw data to MongoDB (device-specific collection)
            const rawHex = buffer.toString('hex');
            saveRawData(deviceIMEI, deviceVIN, rawHex, deviceType).then(id => {
                if (id) log(`[DB] Raw data saved to raw_${deviceType.toLowerCase()}: ${id}`);
            });

            // Save parsed records to MongoDB (device-specific collection)
            if (decoded.avlRecords.length > 0) {
                saveRecords(deviceIMEI, deviceVIN, deviceType, decoded.avlRecords).then(ids => {
                    if (ids) log(`[DB] Saved ${Object.keys(ids).length} records to records_${deviceType.toLowerCase()}`);
                });
            }

            log(`[AVL] Parsing packet...`);
            log(`  Preamble: ${decoded.preamble.toString(16).padStart(8, '0')}`);
            log(`  Data Length: ${decoded.dataFieldLength} bytes`);
            log(`  Codec ID: 0x${decoded.codecId.toString(16)} (${decoded.codecId === 0x8e ? 'Codec 8 Extended' : 'Codec 8'})`);
            log(`  Number of Records: ${decoded.numberOfData1}`);
            log(`  CRC: 0x${decoded.crc.toString(16)}`);

            // Log each record
            decoded.avlRecords.forEach((record, i) => {
                log(`  --- Record ${i + 1} ---`);
                log(`    Timestamp: ${record.timestamp} (raw: ${record.timestampRaw})`);
                log(`    Priority: ${record.priority}`);
                log(`    GPS: Lat=${record.gps.latitude}, Lon=${record.gps.longitude}`);
                log(`    Altitude: ${record.gps.altitude}m, Angle: ${record.gps.angle}°`);
                log(`    Speed: ${record.gps.speed} km/h, Satellites: ${record.gps.satellites}`);
                log(`    IO Event ID: ${record.io.eventIoId}, Total Elements: ${record.io.totalCount}`);

                // Log IO elements (now an array)
                for (const elem of record.io.elements) {
                    const rawHex = elem.raw ? elem.raw.toString('hex') : 'N/A';
                    log(`      [${elem.id}] ${elem.name}: ${elem.value} (hex: ${rawHex})`);
                }
            });

            // Send ACK with number of records
            const ack = Buffer.alloc(4);
            ack.writeUInt32BE(decoded.numberOfData1, 0);
            socket.write(ack);
            logSent(clientId, ack, `AVL ACK (${decoded.numberOfData1} records confirmed)`);
        });

        socket.on('end', () => {
            log(`=== CONNECTION CLOSED: ${clientId} ===`);
            clearTimeout(authTimeout);
            clearInterval(interval);
            clients.delete(clientId);
        });

        socket.on('error', err => {
            log(`[ERROR] ${clientId}: ${err.message}`);
            clearTimeout(authTimeout);
            clearInterval(interval);
            clients.delete(clientId);
        });
    });

    server.listen(PORT, HOST, () => {
        console.log(`TCP server listening on ${HOST}:${PORT}`);
    });
}

startServer();
