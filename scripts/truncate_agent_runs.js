const { Client } = require('pg');
require('dotenv').config();

async function run() {
    let url = process.env.DATABASE_URL;
    if (!url) {
        console.error("No DATABASE_URL");
        process.exit(1);
    }
    // Force direct connection
    url = url.replace(':6543', ':5432');

    console.log("Connecting to", url.replace(/:[^:]*@/, ':****@')); // mask password

    const client = new Client({ connectionString: url });
    await client.connect();

    try {
        console.log("Truncating agent_runs...");
        await client.query('TRUNCATE TABLE agent_runs CASCADE;');
        console.log("Done.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.end();
    }
}

run();
