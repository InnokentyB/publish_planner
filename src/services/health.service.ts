import '../bootstrap-env';
import prisma from '../db';
import { connection as redisConnection } from '../queue';
import { supabase } from './supabase';
import { getDatabaseRuntimeInfo } from '../bootstrap-env';

type HealthStatus = 'ok' | 'degraded' | 'error';

type ComponentHealth = {
    status: HealthStatus;
    latency_ms?: number;
    message?: string;
    details?: Record<string, any>;
};

function nowMs() {
    return Date.now();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

class HealthService {
    async checkDatabase(): Promise<ComponentHealth> {
        const started = nowMs();
        try {
            await withTimeout(prisma.$queryRawUnsafe('SELECT 1 as ok'), 5000, 'database');
            return {
                status: 'ok',
                latency_ms: nowMs() - started,
                details: getDatabaseRuntimeInfo()
            };
        } catch (error: any) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Database check failed',
                details: getDatabaseRuntimeInfo()
            };
        }
    }

    async checkRedis(): Promise<ComponentHealth> {
        const started = nowMs();
        try {
            const pong = await withTimeout(redisConnection.ping(), 3000, 'redis');
            return {
                status: pong === 'PONG' ? 'ok' : 'degraded',
                latency_ms: nowMs() - started,
                details: { response: pong }
            };
        } catch (error: any) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Redis check failed'
            };
        }
    }

    async checkStorage(): Promise<ComponentHealth> {
        const started = nowMs();
        try {
            const { data, error } = await withTimeout(supabase.storage.listBuckets(), 5000, 'storage');
            if (error) {
                throw error;
            }

            return {
                status: 'ok',
                latency_ms: nowMs() - started,
                details: {
                    bucket_count: Array.isArray(data) ? data.length : 0,
                    has_post_images_bucket: Array.isArray(data) ? data.some((bucket: any) => bucket.name === 'post-images') : false
                }
            };
        } catch (error: any) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Supabase storage check failed'
            };
        }
    }

    async checkTelegram(): Promise<ComponentHealth> {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            return {
                status: 'degraded',
                message: 'TELEGRAM_BOT_TOKEN is not configured'
            };
        }

        const started = nowMs();
        try {
            const telegramService = (await import('./telegram.service')).default;
            const me = await withTimeout(telegramService.bot.telegram.getMe(), 5000, 'telegram');
            return {
                status: 'ok',
                latency_ms: nowMs() - started,
                details: {
                    username: me.username,
                    id: me.id
                }
            };
        } catch (error: any) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Telegram check failed'
            };
        }
    }

    async getBasicHealth() {
        return {
            status: 'ok',
            ts: new Date().toISOString(),
            uptime_s: Math.round(process.uptime()),
            database: getDatabaseRuntimeInfo()
        };
    }

    async getDeepHealth() {
        const [database, redis, storage, telegram] = await Promise.all([
            this.checkDatabase(),
            this.checkRedis(),
            this.checkStorage(),
            this.checkTelegram()
        ]);

        const components = { database, redis, storage, telegram };
        const statuses = Object.values(components).map((component) => component.status);
        const overall: HealthStatus = statuses.includes('error')
            ? 'error'
            : statuses.includes('degraded')
                ? 'degraded'
                : 'ok';

        return {
            status: overall,
            ts: new Date().toISOString(),
            uptime_s: Math.round(process.uptime()),
            components
        };
    }
}

export default new HealthService();
