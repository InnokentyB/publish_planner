
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const testSupabaseRest = async () => {
    console.log('Testing Supabase REST API...');
    try {
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
        const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });

        if (error) {
            // It's possible the table doesn't exist yet, which is fine, checking for connection error
            if (error.code === 'PGRST204' || error.message.includes('relation "public.users" does not exist')) {
                console.log('✅ Supabase REST API is accessible (Table users missing, which is expected before migration).');
            } else {
                console.error('❌ Supabase REST API Error:', error.message);
            }
        } else {
            console.log('✅ Supabase REST API is accessible.');
        }
    } catch (e: any) {
        console.error('❌ Supabase REST API Connection Failed:', e.message);
    }
};

const testPostgres = async () => {
    console.log('Testing Postgres Connection...');
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
    });

    try {
        await client.connect();
        console.log('✅ Postgres Connection Established!');
        await client.end();
    } catch (e: any) {
        console.error('❌ Postgres Connection Failed:', e.message);
        console.error('Details:', e);
    }
};

const run = async () => {
    // Original Attempt
    await testSupabaseRest();
    await testPostgres();

    // Try .com instead of .co for DB
    const originalDbUrl = process.env.DATABASE_URL;
    if (originalDbUrl && originalDbUrl.includes('.co')) {
        console.log('\n--- Retrying with .com ---');
        process.env.DATABASE_URL = originalDbUrl.replace('.co', '.com');
        await testPostgres();
        process.env.DATABASE_URL = originalDbUrl; // Restore
    }

    // Try verifying the project URL host
    console.log('\n--- DNS Lookup ---');
    const dns = require('dns');
    const domains = [
        'db.yxwxrpklshlrryynytoa.supabase.co',
        'db.yxwxrpklshlrryynytoa.supabase.com',
        'yxwxrpklshlrryynytoa.supabase.co',
        'yxwxrpklshlrryynytoa.supabase.com'
    ];

    for (const domain of domains) {
        dns.lookup(domain, (err: NodeJS.ErrnoException | null, address: string) => {
            if (err) console.log(`DNS ${domain}: FAILED (${err.code})`);
            else console.log(`DNS ${domain}: ${address}`);
        });
    }
};

run();
