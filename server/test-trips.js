const { MongoClient } = require('mongodb');

async function test() {
    const client = new MongoClient('mongodb://localhost:27017/telem');
    await client.connect();
    const db = client.db();

    const records = await db.collection('records_fmc003')
        .find({ imei: '864275079658715', ignition: { $exists: true } })
        .sort({ timestamp: 1 })
        .toArray();

    console.log('Total records with ignition:', records.length);

    // Find trips
    const trips = [];
    let currentTrip = null;
    let tripRecords = [];

    for (const record of records) {
        if (record.ignition === 1 && !currentTrip) {
            currentTrip = { startTime: record.timestamp, startOdometer: record.totalOdometer };
            tripRecords = [record];
        } else if (record.ignition === 1 && currentTrip) {
            tripRecords.push(record);
        } else if (record.ignition === 0 && currentTrip) {
            tripRecords.push(record);
            currentTrip.endTime = record.timestamp;
            currentTrip.endOdometer = record.totalOdometer;

            // Distance
            if (currentTrip.startOdometer && currentTrip.endOdometer) {
                currentTrip.distanceMeters = currentTrip.endOdometer - currentTrip.startOdometer;
                currentTrip.distanceKm = Math.round(currentTrip.distanceMeters / 100) / 10;
            }

            // Duration
            const startDate = new Date(currentTrip.startTime);
            const endDate = new Date(currentTrip.endTime);
            const durationMs = endDate - startDate;
            const totalMinutes = Math.round(durationMs / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            currentTrip.duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            currentTrip.durationMinutes = totalMinutes;

            // Avg speed from distance/time
            if (currentTrip.distanceMeters && totalMinutes > 0) {
                const durationHours = totalMinutes / 60;
                currentTrip.avgSpeedTotal = Math.round(currentTrip.distanceKm / durationHours * 10) / 10;
            }

            // Max and avg from records
            let maxSpeed = 0;
            let speedSum = 0;
            let speedCount = 0;
            for (const r of tripRecords) {
                const speed = r.obdVehicleSpeed || r.gps?.speed || 0;
                if (speed > 0) {
                    speedSum += speed;
                    speedCount++;
                    if (speed > maxSpeed) maxSpeed = speed;
                }
            }
            currentTrip.maxSpeed = maxSpeed;
            if (speedCount > 0) {
                currentTrip.avgSpeedMoving = Math.round(speedSum / speedCount * 10) / 10;
            }

            currentTrip.recordCount = tripRecords.length;
            trips.push(currentTrip);
            currentTrip = null;
            tripRecords = [];
        }
    }

    console.log('\nTrips found:', trips.length);
    console.log(JSON.stringify(trips, null, 2));

    await client.close();
}
test();
