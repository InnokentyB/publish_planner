
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

        const sqlPath = path.join(__dirname, '../migration.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        console.log('Executing migration SQL...');
        // Split by semicolon? No, pg might handle it if it's a valid script. 
        // But safer to send as one big query if possible, or split.
        // Prisma generates a script with comments.

        await client.query(sql);
        console.log('✅ Migration successful!');

    } catch (e: any) {
        console.error('❌ Migration failed:', e);
    } finally {
        await client.end();
    }
};

run();
