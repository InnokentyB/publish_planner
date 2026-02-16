
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('Connected to DB.');

        const sqlPath = path.join(__dirname, 'storage_policy.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        console.log('Executing Storage Policies...');
        await client.query(sql);
        console.log('✅ Storage Policies applied!');

    } catch (e: any) {
        console.error('❌ Failed to apply policies:', e);
    } finally {
        await client.end();
    }
};

run();
