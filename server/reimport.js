const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/telem';

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();

    console.log('Dropping records_fmc003 collection...');
    await db.collection('records_fmc003').drop().catch(() => console.log('Collection did not exist'));

    console.log('Dropping raw_fmc003 collection...');
    await db.collection('raw_fmc003').drop().catch(() => console.log('Collection did not exist'));

    console.log('Done! Now run: node import-logs.js');
    await client.close();
}

main().catch(console.error);
