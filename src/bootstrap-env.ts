import { config } from 'dotenv';

config();

function ensureSupabaseSslCompatibility(rawUrl: string) {
    if (!rawUrl) return rawUrl;

    try {
        const parsed = new URL(rawUrl);
        const isSupabaseHost = parsed.hostname.includes('supabase.co') || parsed.hostname.includes('pooler.supabase.com');
        if (!isSupabaseHost) {
            return rawUrl;
        }

        const explicitVerify = process.env.DB_SSL_VERIFY === 'true';
        if (explicitVerify) {
            return rawUrl;
        }

        parsed.searchParams.set('sslmode', 'no-verify');
        return parsed.toString();
    } catch {
        return rawUrl;
    }
}

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

    if (process.env.DATABASE_URL) {
        process.env.DATABASE_URL = ensureSupabaseSslCompatibility(process.env.DATABASE_URL);
    }

    const active = process.env.DATABASE_URL?.trim() || '';
    if (active && !process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = ensureSupabaseSslCompatibility(active.replace(':6543', ':5432'));
    } else if (process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = ensureSupabaseSslCompatibility(process.env.DIRECT_DATABASE_URL);
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
            usingRailwayInternalHost: parsed.hostname.includes('railway.internal'),
            sslmode: parsed.searchParams.get('sslmode')
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
            usingRailwayInternalHost: databaseUrl.includes('railway.internal'),
            sslmode: null
        };
    }
}
