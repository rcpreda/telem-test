/**
 * Teltonika Codec 8 / Codec 8 Extended decoder
 * Works directly with raw Buffer from device (no hex conversion)
 */

class Codec8Decoder {
    constructor(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error('Input must be a Buffer');
        }
        this.data = buffer;
        this.offset = 0;
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

        if (result.codecId !== 0x08 && result.codecId !== 0x8e) {
            throw new Error(`Unsupported codec: 0x${result.codecId.toString(16)}`);
        }

        this.isExtended = result.codecId === 0x8e;

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

        // IO Element
        const io = this.decodeIOElement();

        return {
            timestamp: new Date(Number(timestamp)).toISOString(),
            timestampRaw: timestamp.toString(),
            priority,
            gps,
            io
        };
    }

    decodeIOElement() {
        // Codec 8 Extended uses 2-byte IDs and counts, Codec 8 uses 1-byte
        const eventId = this.isExtended ? this.readUInt16() : this.readUInt8();
        const totalElements = this.isExtended ? this.readUInt16() : this.readUInt8();

        const io = {
            eventId,
            totalElements,
            elements: {}
        };

        // 1-byte IO elements
        const count1 = this.isExtended ? this.readUInt16() : this.readUInt8();
        for (let i = 0; i < count1; i++) {
            const id = this.isExtended ? this.readUInt16() : this.readUInt8();
            const value = this.readUInt8();
            io.elements[id] = { size: 1, value, raw: Buffer.from([value]), name: this.getIOName(id) };
        }

        // 2-byte IO elements
        const count2 = this.isExtended ? this.readUInt16() : this.readUInt8();
        for (let i = 0; i < count2; i++) {
            const id = this.isExtended ? this.readUInt16() : this.readUInt8();
            const raw = this.readBytes(2);
            const value = raw.readUInt16BE(0);
            io.elements[id] = { size: 2, value, raw, name: this.getIOName(id) };
        }

        // 4-byte IO elements
        const count4 = this.isExtended ? this.readUInt16() : this.readUInt8();
        for (let i = 0; i < count4; i++) {
            const id = this.isExtended ? this.readUInt16() : this.readUInt8();
            const raw = this.readBytes(4);
            const value = raw.readUInt32BE(0);
            io.elements[id] = { size: 4, value, raw, name: this.getIOName(id) };
        }

        // 8-byte IO elements
        const count8 = this.isExtended ? this.readUInt16() : this.readUInt8();
        for (let i = 0; i < count8; i++) {
            const id = this.isExtended ? this.readUInt16() : this.readUInt8();
            const raw = this.readBytes(8);
            const high = raw.readUInt32BE(0);
            const low = raw.readUInt32BE(4);
            const value = BigInt(high) * BigInt(0x100000000) + BigInt(low);
            io.elements[id] = { size: 8, value: value.toString(), raw, name: this.getIOName(id) };
        }

        // Codec 8 Extended has variable-length (NX) IO elements
        if (this.isExtended) {
            const countNX = this.readUInt16();
            for (let i = 0; i < countNX; i++) {
                const id = this.readUInt16();
                const length = this.readUInt16();
                const raw = this.readBytes(length);

                let value;
                // Decode VIN and other ASCII fields
                if (id === 256 || id === 385) {
                    value = raw.toString('ascii').replace(/\0/g, '');
                } else {
                    value = raw.toString('hex');
                }

                io.elements[id] = { size: length, value, raw, name: this.getIOName(id) };
            }
        }

        return io;
    }

    getIOName(id) {
        const ioNames = {
            1: 'Digital Input 1',
            2: 'Digital Input 2',
            3: 'Digital Input 3',
            4: 'Digital Input 4',
            5: 'Digital Output 1',
            6: 'Digital Output 2',
            9: 'Analog Input 1',
            10: 'Analog Input 2',
            11: 'ICCID1',
            12: 'ICCID2',
            13: 'ICCID3',
            14: 'ICCID4',
            15: 'Eco Score',
            16: 'Total Odometer',
            17: 'Axis X',
            18: 'Axis Y',
            19: 'Axis Z',
            21: 'GSM Signal',
            24: 'Speed',
            25: 'External Voltage',
            26: 'Internal Battery Voltage',
            27: 'GNSS PDOP',
            28: 'GNSS HDOP',
            31: 'GNSS Status',
            32: 'GNSS Fix Mode',
            33: 'GNSS Age',
            35: 'Crash Event',
            36: 'Over Speeding',
            37: 'Harsh Acceleration',
            38: 'Harsh Braking',
            39: 'Harsh Cornering',
            40: 'Unplug',
            41: 'Crash Event Trace',
            42: 'GNSS VDOP',
            43: 'GNSS TDOP',
            44: 'GNSS Position Accuracy',
            45: 'GNSS Speed Accuracy',
            46: 'GNSS Age',
            66: 'External Voltage',
            67: 'Battery Voltage',
            68: 'Battery Current',
            69: 'GNSS Status',
            72: 'Dallas Temperature 1',
            73: 'Dallas Temperature 2',
            74: 'Dallas Temperature 3',
            75: 'Dallas Temperature 4',
            78: 'Driver ID (iButton)',
            80: 'Data Mode',
            81: 'Vehicle Speed',
            82: 'Accelerator Pedal',
            83: 'Fuel Consumed',
            84: 'Fuel Level',
            85: 'Engine RPM',
            87: 'Total Mileage',
            89: 'Fuel Level %',
            90: 'Fuel Type',
            110: 'Fuel Rate',
            113: 'Battery Level',
            175: 'Auto Geofence',
            179: 'Digital Output 1',
            180: 'Digital Output 2',
            181: 'GNSS PDOP',
            182: 'GNSS HDOP',
            199: 'Trip Odometer',
            200: 'Sleep Mode',
            205: 'Cell ID',
            206: 'Area Code',
            236: 'Alarm',
            237: 'Network Type',
            238: 'Operator Code',
            239: 'IMEI',
            240: 'Movement',
            241: 'Active GSM Operator',
            243: 'Green Driving Status',
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
            282: 'DOUT 4',
            283: 'DIN 4',
            284: 'DIN 5',
            303: 'Instant Movement',
            327: 'UL202-02 Sensor Fuel level',
            328: 'UL202-02 Sensor Fuel temp',
            329: 'UL202-02 Sensor Status',
            380: 'Digital Output 3',
            381: 'Ground Sense',
            385: 'Beacon ID',
            389: 'OBD OEM Total Mileage',
            390: 'OBD OEM Fuel Level',
        };
        return ioNames[id] || `Unknown (${id})`;
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
