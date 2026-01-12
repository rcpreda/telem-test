const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/telem';

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();

    console.log('Finding duplicates...');

    // Find all duplicates
    const duplicates = await db.collection('records_fmc003').aggregate([
        {
            $group: {
                _id: { timestamp: "$timestamp", imei: "$imei" },
                count: { $sum: 1 },
                ids: { $push: "$_id" }
            }
        },
        { $match: { count: { $gt: 1 } } }
    ]).toArray();

    console.log(`Found ${duplicates.length} groups with duplicates`);

    let totalRemoved = 0;

    for (const dup of duplicates) {
        // Keep the first ID, remove the rest
        const idsToRemove = dup.ids.slice(1);
        const result = await db.collection('records_fmc003').deleteMany({
            _id: { $in: idsToRemove }
        });
        totalRemoved += result.deletedCount;
    }

    console.log(`Removed ${totalRemoved} duplicate records`);

    // Verify
    const count = await db.collection('records_fmc003').countDocuments();
    console.log(`Total records after cleanup: ${count}`);

    // Try to create unique index now
    try {
        await db.collection('records_fmc003').createIndex(
            { timestamp: 1, imei: 1 },
            { unique: true }
        );
        console.log('Unique index created successfully');
    } catch (err) {
        console.log(`Index creation: ${err.message}`);
    }

    await client.close();
}

main().catch(console.error);
