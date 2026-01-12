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
        // FMC003 OBD Tracker - Complete IO Elements List
        const ioNames = {
            // Permanent I/O Elements
            1: 'Digital Input 1',
            2: 'Digital Input 2',
            3: 'Digital Input 3',
            4: 'Digital Input 4',
            5: 'Digital Output 1',
            6: 'Digital Output 2',
            9: 'Analog Input 1',
            10: 'Analog Input 2',
            11: 'ICCID1',
            12: 'Fuel Used GPS',
            13: 'Fuel Rate GPS',
            14: 'ICCID2',
            15: 'Eco Score',
            16: 'Total Odometer',
            17: 'Accelerometer X',
            18: 'Accelerometer Y',
            19: 'Accelerometer Z',
            21: 'GSM Signal',
            24: 'Speed',
            25: 'External Voltage',
            66: 'External Voltage',
            67: 'Battery Voltage',
            68: 'Battery Current',
            69: 'GNSS Status',
            72: 'Dallas Temperature 1',
            73: 'Dallas Temperature 2',
            74: 'Dallas Temperature 3',
            75: 'Dallas Temperature 4',
            76: 'Dallas ID 1',
            77: 'Dallas ID 2',
            78: 'Dallas ID 3',
            79: 'Dallas ID 4',
            80: 'Data Mode',
            113: 'Battery Level',
            175: 'Auto Geofence',
            180: 'GNSS Sleep Mode',
            181: 'GNSS PDOP',
            182: 'GNSS HDOP',
            199: 'Trip Odometer',
            200: 'Sleep Mode',
            205: 'GSM Cell ID',
            206: 'GSM Area Code',
            236: 'Alarm',
            237: 'Network Type',
            238: 'Operator Code',
            239: 'Ignition',
            240: 'Movement',
            241: 'Active GSM Operator',
            243: 'Green Driving Event Duration',
            246: 'Towing Detection',
            247: 'Crash Detection',
            249: 'Jamming Detection',
            250: 'Trip Event',
            251: 'Idling Event',
            252: 'Unplug Event',
            253: 'Green Driving Value',
            254: 'Overspeeding Event',
            255: 'Geofence Zone 01',
            256: 'VIN',
            257: 'Crash Trace Data',
            263: 'BT Status',
            264: 'Barcode ID',
            269: 'Instant Movement',
            303: 'Instant Movement',
            310: 'Movement Event',
            311: 'Deep Sleep',
            385: 'Beacon',

            // OBD II / CAN Parameters (FMC003 specific)
            30: 'Number of DTC',
            31: 'Engine Load',
            32: 'Coolant Temperature',
            33: 'Short Fuel Trim',
            34: 'Fuel Pressure',
            35: 'Intake MAP',
            36: 'Engine RPM',
            37: 'Vehicle Speed (OBD)',
            38: 'Timing Advance',
            39: 'Intake Air Temperature',
            40: 'MAF',
            41: 'Throttle Position',
            42: 'Runtime Since Engine Start',
            43: 'Distance With MIL On',
            44: 'Relative Fuel Rail Pressure',
            45: 'Direct Fuel Rail Pressure',
            46: 'Commanded EGR',
            47: 'EGR Error',
            48: 'Fuel Level',
            49: 'Distance Since Codes Cleared',
            50: 'Barometric Pressure',
            51: 'Control Module Voltage',
            52: 'Absolute Load Value',
            53: 'Ambient Air Temperature',
            54: 'Time With MIL On',
            55: 'Time Since Codes Cleared',
            56: 'Absolute Fuel Rail Pressure',
            57: 'Hybrid Battery Pack Life',
            58: 'Engine Oil Temperature',
            59: 'Fuel Injection Timing',
            60: 'Fuel Rate (OBD)',

            // OBD Extended
            281: 'Long Fuel Trim',
            282: 'Engine Oil Pressure',
            283: 'Engine Oil Level',
            284: 'Engine Oil Lifetime',
            285: 'Engine Oil Service Distance',
            286: 'Accelerator Pedal Position',
            287: 'Brake Pedal Position',
            288: 'Total Driving Time',
            289: 'Total Idling Time',
            290: 'Total Driven Distance',

            // Fault Codes
            387: 'DTC Faults',
            388: 'Pending DTC Faults',

            // OBD Totals
            389: 'OBD Total Mileage',
            390: 'OBD Fuel Level Input',

            // CAN Data
            391: 'Fuel Consumed',
            392: 'Engine Total Fuel Used',
            393: 'Engine Total Hours',
            394: 'Vehicle Distance',
            395: 'Brake Pedal Switch',
            396: 'Cruise Control Active',
            397: 'PTO State',
            398: 'Accelerator Pedal Position 2',

            // Driver Behavior
            449: 'Harsh Acceleration',
            450: 'Harsh Braking',
            451: 'Harsh Cornering',

            // Extended Geofences
            155: 'Geofence Zone 02',
            156: 'Geofence Zone 03',
            157: 'Geofence Zone 04',
            158: 'Geofence Zone 05',
            768: 'Geofence Zone 06',
            769: 'Geofence Zone 07',
            770: 'Geofence Zone 08',
            771: 'Geofence Zone 09',
            772: 'Geofence Zone 10',
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
