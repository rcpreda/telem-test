const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 5027;
const HOST = '0.0.0.0';
const DATA_INTERVAL = 10000; // Request data every 10 seconds
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const clients = new Map();

function getHourlyLogFile() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    return path.join(LOGS_DIR, `${year}-${month}-${day}_${hour}.txt`);
}

function logToFile(clientId, data) {
    const logFile = getHourlyLogFile();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${clientId}: ${data}\n`;
    fs.appendFileSync(logFile, line);
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

    socket.on('data', data => {
        const hex = data.toString('hex');
        console.log(`[${new Date().toISOString()}] RAW DATA from ${clientId}:`, hex);

        // Log raw data to hourly file
        logToFile(clientId, hex);

        // Check if this is a login packet (starts with 000f and contains IMEI)
        if (hex.startsWith('000f')) {
            const imeiHex = hex.slice(4);
            const imei = Buffer.from(imeiHex, 'hex').toString('ascii');
            console.log(`[${new Date().toISOString()}] Device login - IMEI: ${imei}`);

            // Send acknowledgment (0x01 = accept)
            const response = Buffer.from([0x01]);
            socket.write(response);
            console.log(`[${new Date().toISOString()}] Sent login ACK to ${clientId}`);
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