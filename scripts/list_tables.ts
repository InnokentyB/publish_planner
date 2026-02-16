
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function listTables() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('Tables in Supabase:', res.rows.map(r => r.table_name));
    } catch (e) {
        console.error('Error listing tables:', e);
    } finally {
        await client.end();
    }
}

listTables();
