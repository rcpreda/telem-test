/**
 * Teltonika Codec 8 / Codec 8 Extended decoder
 * Strict implementation according to Teltonika protocol specification
 */

class Codec8Decoder {
    constructor(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error('Input must be a Buffer');
        }
        this.data = buffer;
        this.offset = 0;
        this.isExtended = false;
    }

    readBytes(n) {
        if (this.offset + n > this.data.length) {
            throw new Error(`Buffer overflow: tried to read ${n} bytes at offset ${this.offset}, buffer length ${this.data.length}`);
        }
        const bytes = this.data.slice(this.offset, this.offset + n);
        this.offset += n;
        return bytes;
    }

    readUInt8() {
        if (this.offset + 1 > this.data.length) {
            throw new Error(`Buffer overflow at offset ${this.offset}`);
        }
        const val = this.data.readUInt8(this.offset);
        this.offset += 1;
        return val;
    }

    readUInt16() {
        if (this.offset + 2 > this.data.length) {
            throw new Error(`Buffer overflow at offset ${this.offset}`);
        }
        const val = this.data.readUInt16BE(this.offset);
        this.offset += 2;
        return val;
    }

    readUInt32() {
        if (this.offset + 4 > this.data.length) {
            throw new Error(`Buffer overflow at offset ${this.offset}`);
        }
        const val = this.data.readUInt32BE(this.offset);
        this.offset += 4;
        return val;
    }

    readInt32() {
        if (this.offset + 4 > this.data.length) {
            throw new Error(`Buffer overflow at offset ${this.offset}`);
        }
        const val = this.data.readInt32BE(this.offset);
        this.offset += 4;
        return val;
    }

    readUInt64() {
        if (this.offset + 8 > this.data.length) {
            throw new Error(`Buffer overflow at offset ${this.offset}`);
        }
        const high = this.data.readUInt32BE(this.offset);
        const low = this.data.readUInt32BE(this.offset + 4);
        this.offset += 8;
        return BigInt(high) * BigInt(0x100000000) + BigInt(low);
    }

    decode() {
        const result = {
            preamble: this.readUInt32(),
            dataFieldLength: this.readUInt32(),
            codecId: this.readUInt8(),
            numberOfData1: this.readUInt8(),
            avlRecords: []
        };

        // Determine codec type
        if (result.codecId === 0x08) {
            this.isExtended = false;
        } else if (result.codecId === 0x8e) {
            this.isExtended = true;
        } else {
            throw new Error(`Unsupported codec: 0x${result.codecId.toString(16)}`);
        }

        for (let i = 0; i < result.numberOfData1; i++) {
            const record = this.decodeAVLRecord();
            result.avlRecords.push(record);
        }

        result.numberOfData2 = this.readUInt8();
        result.crc = this.readUInt32();

        return result;
    }

    decodeAVLRecord() {
        const timestamp = this.readUInt64();
        const priority = this.readUInt8();

        // GPS Element
        const gps = {
            longitude: this.readInt32() / 10000000,
            latitude: this.readInt32() / 10000000,
            altitude: this.readUInt16(),
            angle: this.readUInt16(),
            satellites: this.readUInt8(),
            speed: this.readUInt16()
        };

        // IO Element - completely different for Codec 8 vs 8E
        const io = this.isExtended ? this.decodeIOElementExtended() : this.decodeIOElementStandard();

        return {
            timestamp: new Date(Number(timestamp)).toISOString(),
            timestampRaw: timestamp.toString(),
            priority,
            gps,
            io
        };
    }

    /**
     * Codec 8 Standard IO Element
     * - All IDs are 1 byte
     * - All counts are 1 byte
     */
    decodeIOElementStandard() {
        const eventIoId = this.readUInt8();
        const totalCount = this.readUInt8();

        const io = {
            eventIoId,
            totalCount,
            elements: []
        };

        // 1-byte values
        const n1 = this.readUInt8();
        for (let i = 0; i < n1; i++) {
            const id = this.readUInt8();
            const raw = this.readBytes(1);
            io.elements.push({
                id,
                size: 1,
                value: raw.readUInt8(0),
                raw,
                name: this.getIOName(id)
            });
        }

        // 2-byte values
        const n2 = this.readUInt8();
        for (let i = 0; i < n2; i++) {
            const id = this.readUInt8();
            const raw = this.readBytes(2);
            io.elements.push({
                id,
                size: 2,
                value: raw.readUInt16BE(0),
                raw,
                name: this.getIOName(id)
            });
        }

        // 4-byte values
        const n4 = this.readUInt8();
        for (let i = 0; i < n4; i++) {
            const id = this.readUInt8();
            const raw = this.readBytes(4);
            io.elements.push({
                id,
                size: 4,
                value: raw.readUInt32BE(0),
                raw,
                name: this.getIOName(id)
            });
        }

        // 8-byte values
        const n8 = this.readUInt8();
        for (let i = 0; i < n8; i++) {
            const id = this.readUInt8();
            const raw = this.readBytes(8);
            const high = raw.readUInt32BE(0);
            const low = raw.readUInt32BE(4);
            io.elements.push({
                id,
                size: 8,
                value: (BigInt(high) * BigInt(0x100000000) + BigInt(low)).toString(),
                raw,
                name: this.getIOName(id)
            });
        }

        return io;
    }

    /**
     * Codec 8 Extended IO Element
     * - All IDs are 2 bytes
     * - All counts are 2 bytes
     * - Has NX variable-length elements
     */
    decodeIOElementExtended() {
        const eventIoId = this.readUInt16();
        const totalCount = this.readUInt16();

        const io = {
            eventIoId,
            totalCount,
            elements: []
        };

        // N1: 1-byte values
        const n1 = this.readUInt16();
        for (let i = 0; i < n1; i++) {
            const id = this.readUInt16();
            const raw = this.readBytes(1);
            io.elements.push({
                id,
                size: 1,
                value: raw.readUInt8(0),
                raw,
                name: this.getIOName(id)
            });
        }

        // N2: 2-byte values
        const n2 = this.readUInt16();
        for (let i = 0; i < n2; i++) {
            const id = this.readUInt16();
            const raw = this.readBytes(2);
            io.elements.push({
                id,
                size: 2,
                value: raw.readUInt16BE(0),
                raw,
                name: this.getIOName(id)
            });
        }

        // N4: 4-byte values
        const n4 = this.readUInt16();
        for (let i = 0; i < n4; i++) {
            const id = this.readUInt16();
            const raw = this.readBytes(4);
            io.elements.push({
                id,
                size: 4,
                value: raw.readUInt32BE(0),
                raw,
                name: this.getIOName(id)
            });
        }

        // N8: 8-byte values
        const n8 = this.readUInt16();
        for (let i = 0; i < n8; i++) {
            const id = this.readUInt16();
            const raw = this.readBytes(8);
            const high = raw.readUInt32BE(0);
            const low = raw.readUInt32BE(4);
            io.elements.push({
                id,
                size: 8,
                value: (BigInt(high) * BigInt(0x100000000) + BigInt(low)).toString(),
                raw,
                name: this.getIOName(id)
            });
        }

        // NX: Variable-length values (Codec 8E only)
        const nx = this.readUInt16();
        for (let i = 0; i < nx; i++) {
            const id = this.readUInt16();
            const length = this.readUInt16();
            const raw = this.readBytes(length);

            let value;
            // ASCII decode for known string fields
            if (id === 256 || id === 281 || id === 385) {
                value = raw.toString('ascii').replace(/\0/g, '');
            } else {
                value = raw.toString('hex');
            }

            io.elements.push({
                id,
                size: length,
                value,
                raw,
                name: this.getIOName(id)
            });
        }

        return io;
    }

    getIOName(id) {
        // FMC003 OBD Tracker IO Elements
        const ioNames = {
            1: 'Digital Input 1',
            2: 'Digital Input 2',
            3: 'Digital Input 3',
            4: 'Digital Input 4',
            5: 'Digital Output 1',
            6: 'Digital Output 2',
            9: 'Analog Input 1',
            10: 'Analog Input 2',
            11: 'ICCID',
            12: 'Fuel Used GPS',
            13: 'Fuel Rate GPS',
            14: 'Average Fuel Use',
            15: 'Eco Score',
            16: 'Total Odometer',
            17: 'Axis X',
            18: 'Axis Y',
            19: 'Axis Z',
            21: 'GSM Signal',
            24: 'Speed',
            25: 'External Voltage',
            26: 'Internal Battery Voltage',
            30: 'Number of DTC',
            66: 'External Voltage (mV)',
            67: 'Battery Voltage (mV)',
            68: 'Battery Current (mA)',
            69: 'GNSS Status',
            80: 'Data Mode',
            113: 'Battery Level %',
            175: 'Auto Geofence',
            181: 'GNSS PDOP',
            182: 'GNSS HDOP',
            199: 'Trip Odometer',
            200: 'Sleep Mode',
            205: 'Cell ID',
            206: 'Area Code',
            236: 'Alarm',
            237: 'Network Type',
            238: 'Operator Code',
            239: 'Ignition',
            240: 'Movement',
            241: 'GSM Operator',
            243: 'Green Driving Type',
            246: 'Towing Detection',
            247: 'Crash Detection',
            249: 'Jamming Detection',
            250: 'Trip',
            251: 'Idling',
            252: 'Ignition',
            253: 'Green Driving Value',
            254: 'Over Speeding',
            255: 'Geofence Zone',
            256: 'VIN',
            281: 'DOUT 3',
            303: 'Instant Movement',
            385: 'Beacon',
            389: 'OBD Total Mileage',
            390: 'OBD Fuel Level',
        };
        return ioNames[id] || `IO_${id}`;
    }
}

/**
 * Decode Codec 8 / 8E data from raw Buffer
 * @param {Buffer} buffer - Raw buffer from device
 * @returns {Object} Decoded data or error object
 */
function decodeCodec8(buffer) {
    try {
        const decoder = new Codec8Decoder(buffer);
        return decoder.decode();
    } catch (error) {
        return { error: error.message };
    }
}

/**
 * Parse IMEI from raw login buffer
 * @param {Buffer} buffer - Raw buffer from device
 * @returns {string|null} IMEI string or null
 */
function parseIMEI(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 2) return null;

    const len = buffer.readUInt16BE(0);
    if (len !== 15) return null;
    if (buffer.length < 2 + len) return null;

    return buffer.slice(2, 2 + len).toString('ascii');
}

module.exports = { Codec8Decoder, decodeCodec8, parseIMEI };
