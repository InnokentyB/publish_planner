"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("../bootstrap-env");
const db_1 = __importDefault(require("../db"));
const queue_1 = require("../queue");
const supabase_1 = require("./supabase");
const bootstrap_env_1 = require("../bootstrap-env");
const schema_plan_service_1 = __importDefault(require("./schema_plan.service"));
function nowMs() {
    return Date.now();
}
async function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
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
    async checkDatabase() {
        const started = nowMs();
        try {
            await withTimeout(db_1.default.$queryRawUnsafe('SELECT 1 as ok'), 5000, 'database');
            return {
                status: 'ok',
                latency_ms: nowMs() - started,
                details: (0, bootstrap_env_1.getDatabaseRuntimeInfo)()
            };
        }
        catch (error) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Database check failed',
                details: (0, bootstrap_env_1.getDatabaseRuntimeInfo)()
            };
        }
    }
    async checkRedis() {
        const started = nowMs();
        try {
            const pong = await withTimeout(queue_1.connection.ping(), 3000, 'redis');
            return {
                status: pong === 'PONG' ? 'ok' : 'degraded',
                latency_ms: nowMs() - started,
                details: { response: pong }
            };
        }
        catch (error) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Redis check failed'
            };
        }
    }
    async checkStorage() {
        const started = nowMs();
        try {
            const { data, error } = await withTimeout(supabase_1.supabase.storage.listBuckets(), 5000, 'storage');
            if (error) {
                throw error;
            }
            return {
                status: 'ok',
                latency_ms: nowMs() - started,
                details: {
                    bucket_count: Array.isArray(data) ? data.length : 0,
                    has_post_images_bucket: Array.isArray(data) ? data.some((bucket) => bucket.name === 'post-images') : false
                }
            };
        }
        catch (error) {
            return {
                status: 'error',
                latency_ms: nowMs() - started,
                message: error?.message || 'Supabase storage check failed'
            };
        }
    }
    async checkTelegram() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            return {
                status: 'degraded',
                message: 'TELEGRAM_BOT_TOKEN is not configured'
            };
        }
        const started = nowMs();
        try {
            const telegramService = (await Promise.resolve().then(() => __importStar(require('./telegram.service')))).default;
            const me = await withTimeout(telegramService.bot.telegram.getMe(), 5000, 'telegram');
            return {
                status: 'ok',
                latency_ms: nowMs() - started,
                details: {
                    username: me.username,
                    id: me.id
                }
            };
        }
        catch (error) {
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
            database: (0, bootstrap_env_1.getDatabaseRuntimeInfo)(),
            schema_plan: schema_plan_service_1.default.getPlan()
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
        const overall = statuses.includes('error')
            ? 'error'
            : statuses.includes('degraded')
                ? 'degraded'
                : 'ok';
        return {
            status: overall,
            ts: new Date().toISOString(),
            uptime_s: Math.round(process.uptime()),
            schema_plan: schema_plan_service_1.default.getPlan(),
            components
        };
    }
}
exports.default = new HealthService();
