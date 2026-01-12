const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/telem';

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();

    const count = await db.collection('records_fmc003').countDocuments();
    console.log(`Total records in records_fmc003: ${count}`);

    // Check for duplicates by timestamp + imei
    const duplicates = await db.collection('records_fmc003').aggregate([
        {
            $group: {
                _id: { timestamp: "$timestamp", imei: "$imei" },
                count: { $sum: 1 },
                ids: { $push: "$_id" }
            }
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
    ]).toArray();

    if (duplicates.length > 0) {
        console.log(`\nFound ${duplicates.length} duplicate groups:`);
        for (const dup of duplicates) {
            console.log(`  ${dup._id.timestamp} - ${dup._id.imei}: ${dup.count} copies`);
        }
    } else {
        console.log('\nNo duplicates found (by timestamp + imei)');
    }

    // Show date range of records
    const oldest = await db.collection('records_fmc003').findOne({}, { sort: { timestamp: 1 } });
    const newest = await db.collection('records_fmc003').findOne({}, { sort: { timestamp: -1 } });

    console.log(`\nDate range: ${oldest?.timestamp} to ${newest?.timestamp}`);

    // Count records with importedFromLogs flag
    const importedCount = await db.collection('records_fmc003').countDocuments({ importedFromLogs: true });
    console.log(`Records imported from logs: ${importedCount}`);

    await client.close();
}

main().catch(console.error);
