const net = require('net');
const fs = require('fs');
const path = require('path');
const { decodeCodec8 } = require('./codec8');

const PORT = 5027;
const HOST = '0.0.0.0';
const DATA_INTERVAL = 5000;
const LOGS_DIR = path.join(__dirname, 'logs');

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

const server = net.createServer(socket => {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    log(`=== NEW CONNECTION: ${clientId} ===`);

    let deviceIMEI = null;

    const interval = setInterval(() => {
        if (socket.writable) {
            log(`[POLL] ${clientId}`);
        }
    }, DATA_INTERVAL);

    clients.set(clientId, { socket, interval });

    socket.on('data', buffer => {
        // Log raw received data
        logReceived(clientId, buffer);

        // IMEI login phase
        const imei = parseIMEI(buffer);
        if (imei) {
            deviceIMEI = imei;
            log(`[LOGIN] IMEI: ${imei}`);
            log(`  Parsed from: length=${buffer.readUInt16BE(0)}, imei_bytes=${buffer.slice(2, 17).toString('hex')}`);

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
            log(`    IO Event ID: ${record.io.eventId}, Total Elements: ${record.io.totalElements}`);

            // Log IO elements
            for (const [id, elem] of Object.entries(record.io.elements)) {
                const rawHex = elem.raw ? elem.raw.toString('hex') : 'N/A';
                log(`      [${id}] ${elem.name}: ${elem.value} (hex: ${rawHex})`);
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
        clearInterval(interval);
        clients.delete(clientId);
    });

    socket.on('error', err => {
        log(`[ERROR] ${clientId}: ${err.message}`);
        clearInterval(interval);
        clients.delete(clientId);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`TCP server listening on ${HOST}:${PORT}`);
});
