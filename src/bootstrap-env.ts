import { config } from 'dotenv';

config();

function getPlannerSchema() {
    return (
        process.env.APP_DB_SCHEMA?.trim()
        || process.env.PLANNER_DB_SCHEMA?.trim()
        || 'planner'
    );
}

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

function ensurePlannerSchemaCompatibility(rawUrl: string) {
    if (!rawUrl) return rawUrl;

    try {
        const parsed = new URL(rawUrl);
        const plannerSchema = getPlannerSchema();

        if (!parsed.searchParams.get('schema')) {
            parsed.searchParams.set('schema', plannerSchema);
        }

        const currentOptions = parsed.searchParams.get('options') || '';
        const searchPathFlag = `-c search_path=${plannerSchema}`;
        if (!currentOptions.includes('search_path=')) {
            parsed.searchParams.set('options', currentOptions ? `${currentOptions} ${searchPathFlag}` : searchPathFlag);
        }

        return parsed.toString();
    } catch {
        return rawUrl;
    }
}

function normalizeDatabaseUrl() {
    const appDatabaseUrl = process.env.APP_DATABASE_URL?.trim() || '';
    const current = process.env.DATABASE_URL?.trim() || '';
    const supabaseDbUrl = process.env.SUPABASE_DB_URL?.trim()
        || process.env.SUPABASE_DATABASE_URL?.trim()
        || '';
    const preferredRuntimeUrl = appDatabaseUrl || current;

    const shouldPreferSupabase = !preferredRuntimeUrl
        || preferredRuntimeUrl.includes('railway.internal')
        || preferredRuntimeUrl.includes('localhost')
        || preferredRuntimeUrl.includes('127.0.0.1');

    if (appDatabaseUrl) {
        process.env.DATABASE_URL = appDatabaseUrl;
    }

    if (shouldPreferSupabase && supabaseDbUrl) {
        process.env.DATABASE_URL = supabaseDbUrl;
    }

    if (process.env.DATABASE_URL) {
        process.env.DATABASE_URL = ensureSupabaseSslCompatibility(process.env.DATABASE_URL);
        process.env.DATABASE_URL = ensurePlannerSchemaCompatibility(process.env.DATABASE_URL);
    }

    const explicitDirectUrl = process.env.APP_DIRECT_DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim() || '';
    const active = process.env.DATABASE_URL?.trim() || '';
    if (explicitDirectUrl) {
        process.env.DIRECT_DATABASE_URL = ensureSupabaseSslCompatibility(explicitDirectUrl);
    } else if (active && !process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = ensureSupabaseSslCompatibility(active.replace(':6543', ':5432'));
    } else if (process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = ensureSupabaseSslCompatibility(process.env.DIRECT_DATABASE_URL);
    }

    if (process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = ensurePlannerSchemaCompatibility(process.env.DIRECT_DATABASE_URL);
    }
}

function normalizeSchemaEnv() {
    const appDbSchema = process.env.APP_DB_SCHEMA?.trim();
    const appTargetDbSchema = process.env.APP_TARGET_DB_SCHEMA?.trim();

    if (appDbSchema && !process.env.PLANNER_DB_SCHEMA) {
        process.env.PLANNER_DB_SCHEMA = appDbSchema;
    }

    if (appTargetDbSchema && !process.env.PLANNER_TARGET_SCHEMA) {
        process.env.PLANNER_TARGET_SCHEMA = appTargetDbSchema;
    }
}

normalizeDatabaseUrl();
normalizeSchemaEnv();

const plannerSchema = getPlannerSchema();
if (!process.env.PGOPTIONS?.includes('search_path=')) {
    process.env.PGOPTIONS = process.env.PGOPTIONS
        ? `${process.env.PGOPTIONS} -c search_path=${plannerSchema}`
        : `-c search_path=${plannerSchema}`;
}

export function getDatabaseRuntimeInfo() {
    const databaseUrl = process.env.DATABASE_URL || '';

    try {
        const parsed = new URL(databaseUrl);
        return {
            configured: Boolean(databaseUrl),
            source: process.env.APP_DATABASE_URL
                ? 'app_database_url'
                : process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL
                    ? 'supabase'
                    : 'database_url',
            protocol: parsed.protocol.replace(':', ''),
            host: parsed.hostname,
            port: parsed.port || null,
            database: parsed.pathname.replace(/^\//, '') || null,
            schema: parsed.searchParams.get('schema') || plannerSchema,
            usingPooler: parsed.port === '6543',
            usingRailwayInternalHost: parsed.hostname.includes('railway.internal'),
            sslmode: parsed.searchParams.get('sslmode'),
            pgoptions: process.env.PGOPTIONS || null
        };
    } catch {
        return {
            configured: Boolean(databaseUrl),
            source: process.env.APP_DATABASE_URL
                ? 'app_database_url'
                : process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL
                    ? 'supabase'
                    : 'database_url',
            protocol: null,
            host: null,
            port: null,
            database: null,
            schema: plannerSchema,
            usingPooler: false,
            usingRailwayInternalHost: databaseUrl.includes('railway.internal'),
            sslmode: null,
            pgoptions: process.env.PGOPTIONS || null
        };
    }
}
