import { config } from 'dotenv';

config();

function normalizeDatabaseUrl() {
    const current = process.env.DATABASE_URL?.trim() || '';
    const supabaseDbUrl = process.env.SUPABASE_DB_URL?.trim()
        || process.env.SUPABASE_DATABASE_URL?.trim()
        || '';

    const shouldPreferSupabase = !current
        || current.includes('railway.internal')
        || current.includes('localhost')
        || current.includes('127.0.0.1');

    if (shouldPreferSupabase && supabaseDbUrl) {
        process.env.DATABASE_URL = supabaseDbUrl;
    }

    const active = process.env.DATABASE_URL?.trim() || '';
    if (active && !process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = active.replace(':6543', ':5432');
    }
}

normalizeDatabaseUrl();

export function getDatabaseRuntimeInfo() {
    const databaseUrl = process.env.DATABASE_URL || '';

    try {
        const parsed = new URL(databaseUrl);
        return {
            configured: Boolean(databaseUrl),
            source: process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL ? 'supabase' : 'database_url',
            protocol: parsed.protocol.replace(':', ''),
            host: parsed.hostname,
            port: parsed.port || null,
            database: parsed.pathname.replace(/^\//, '') || null,
            usingPooler: parsed.port === '6543',
            usingRailwayInternalHost: parsed.hostname.includes('railway.internal')
        };
    } catch {
        return {
            configured: Boolean(databaseUrl),
            source: process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL ? 'supabase' : 'database_url',
            protocol: null,
            host: null,
            port: null,
            database: null,
            usingPooler: false,
            usingRailwayInternalHost: databaseUrl.includes('railway.internal')
        };
    }
}
