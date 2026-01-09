const net = require('net');
const fs = require('fs');
const path = require('path');
const { decodeCodec8, parseIMEI } = require('./codec8');

const PORT = 5027;
const HOST = '0.0.0.0';
const DATA_INTERVAL = 10000; // Request data every 10 seconds
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const clients = new Map();

function getHourlyDir() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const dirPath = path.join(LOGS_DIR, `${year}-${month}-${day}_${hour}`);

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    return dirPath;
}

function logRawData(clientId, data) {
    const dir = getHourlyDir();
    const timestamp = new Date().toISOString();
    const filePath = path.join(dir, 'raw.txt');
    const content = `[${timestamp}] ${clientId}: ${data}\n`;
    fs.appendFileSync(filePath, content);
}

function logDecodedData(clientId, imei, decoded) {
    const dir = getHourlyDir();
    const timestamp = new Date().toISOString();
    const filePath = path.join(dir, 'decoded.txt');

    let content = `\n[${timestamp}] Client: ${clientId}\n`;
    content += `IMEI: ${imei || 'Unknown'}\n`;
    content += `Codec ID: ${decoded.codecId} (${decoded.codecId === 0x8e ? 'Extended' : 'Standard'})\n`;
    content += `Number of records: ${decoded.numberOfData1}\n`;
    content += `CRC: 0x${decoded.crc.toString(16)}\n`;

    decoded.avlRecords.forEach((record, index) => {
        content += `\n--- Record ${index + 1} ---\n`;
        content += `Timestamp: ${record.timestamp}\n`;
        content += `Priority: ${record.priority}\n`;
        content += `GPS:\n`;
        content += `  Latitude: ${record.gps.latitude}\n`;
        content += `  Longitude: ${record.gps.longitude}\n`;
        content += `  Altitude: ${record.gps.altitude}m\n`;
        content += `  Angle: ${record.gps.angle}°\n`;
        content += `  Speed: ${record.gps.speed} km/h\n`;
        content += `  Satellites: ${record.gps.satellites}\n`;
        content += `IO Elements (Event ID: ${record.io.eventId}):\n`;

        for (const [id, element] of Object.entries(record.io.elements)) {
            content += `  [${id}] ${element.name}: ${element.value}\n`;
        }
    });

    content += `\n========================================\n`;
    fs.appendFileSync(filePath, content);
}

const server = net.createServer(socket => {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log('New connection from', clientId);

    // Set up interval to periodically request/log data
    const interval = setInterval(() => {
        if (socket.writable) {
            console.log(`[${new Date().toISOString()}] Polling client ${clientId}`);
            // Uncomment and modify below to send a request command to device
            // socket.write(Buffer.from([0x78, 0x78, ...])); // device-specific command
        }
    }, DATA_INTERVAL);

    clients.set(clientId, { socket, interval });

    let deviceIMEI = null;

    socket.on('data', data => {
        const hex = data.toString('hex');
        console.log(`[${new Date().toISOString()}] RAW DATA from ${clientId}:`, hex);

        // Log raw data to hourly folder
        logRawData(clientId, hex);

        // Check if this is a login packet (starts with 000f and contains IMEI)
        const imei = parseIMEI(hex);
        if (imei) {
            deviceIMEI = imei;
            console.log(`[${new Date().toISOString()}] Device login - IMEI: ${imei}`);

            // Send acknowledgment (0x01 = accept)
            const response = Buffer.from([0x01]);
            socket.write(response);
            console.log(`[${new Date().toISOString()}] Sent login ACK to ${clientId}`);
        } else {
            // Try to decode as Codec 8 data
            const decoded = decodeCodec8(hex);

            if (decoded.error) {
                console.log(`[${new Date().toISOString()}] Decode error:`, decoded.error);
            } else {
                // Log decoded data to hourly folder
                logDecodedData(clientId, deviceIMEI, decoded);

                console.log(`\n[${new Date().toISOString()}] === DECODED DATA (IMEI: ${deviceIMEI}) ===`);
                console.log(`Codec ID: ${decoded.codecId}`);
                console.log(`Number of records: ${decoded.numberOfData1}`);

                decoded.avlRecords.forEach((record, index) => {
                    console.log(`\n--- Record ${index + 1} ---`);
                    console.log(`Timestamp: ${record.timestamp}`);
                    console.log(`Priority: ${record.priority}`);
                    console.log(`GPS:`);
                    console.log(`  Latitude: ${record.gps.latitude}`);
                    console.log(`  Longitude: ${record.gps.longitude}`);
                    console.log(`  Altitude: ${record.gps.altitude}m`);
                    console.log(`  Angle: ${record.gps.angle}°`);
                    console.log(`  Speed: ${record.gps.speed} km/h`);
                    console.log(`  Satellites: ${record.gps.satellites}`);
                    console.log(`IO Elements (Event ID: ${record.io.eventId}):`);

                    for (const [id, element] of Object.entries(record.io.elements)) {
                        console.log(`  [${id}] ${element.name}: ${element.value}`);
                    }
                });

                console.log(`\nCRC: 0x${decoded.crc.toString(16)}`);
                console.log(`=====================================\n`);

                // Send acknowledgment with number of records received
                const ackResponse = Buffer.alloc(4);
                ackResponse.writeUInt32BE(decoded.numberOfData1, 0);
                socket.write(ackResponse);
                console.log(`[${new Date().toISOString()}] Sent ACK for ${decoded.numberOfData1} records`);
            }
        }
    });

    socket.on('end', () => {
        console.log('Connection closed:', clientId);
        clearInterval(interval);
        clients.delete(clientId);
    });

    socket.on('error', err => {
        console.error('Socket error:', clientId, err.message);
        clearInterval(interval);
        clients.delete(clientId);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`TCP server listening on ${HOST}:${PORT}`);
    console.log(`Data polling interval: ${DATA_INTERVAL}ms`);
});