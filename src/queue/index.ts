import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const getRedisUrl = () => {
    if (process.env.REDIS_URL) return process.env.REDIS_URL;
    
    // Railway specific fallbacks
    if (process.env.REDISHOST) {
        const host = process.env.REDISHOST;
        const port = process.env.REDISPORT || '6379';
        const password = process.env.REDISPASSWORD || '';
        const user = process.env.REDISUSER || '';
        
        if (password) {
            return `redis://${user}:${password}@${host}:${port}`;
        }
        return `redis://${host}:${port}`;
    }
    
    return 'redis://localhost:6379';
};

const redisUrl = getRedisUrl();

// Passed to Workers/Queues
export const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
});

let lastErrorLog = 0;
connection.on('error', (err: any) => {
    const now = Date.now();
    // Throttle error logging to once every 30 seconds to avoid spamming
    if (now - lastErrorLog < 30000) return;
    lastErrorLog = now;

    if (err.code === 'ECONNREFUSED') {
        console.error(`[Redis] Connection Refused at ${err.address}:${err.port}.`);
        
        if (process.env.NODE_ENV !== 'production') {
            console.log('\n--- 💡 LOCAL DEV HINT ---');
            console.log('It looks like your local Redis/Docker is not running.');
            console.log('1. Start Docker');
            console.log('2. Run: docker-compose up -d redis');
            console.log('-------------------------\n');
        } else {
            console.error('[Production Error] Redis is unreachable. Check Railway service linking and REDIS_URL/REDISHOST variables.');
        }
    } else {
        console.error('[Redis] Connection Error:', err);
    }
});

connection.on('connect', () => {
    console.log('[Redis] Success! Connected to:', redisUrl.replace(/:[^:]*@/, ':***@'));
});

// 1. Topics Queue 
export const topicsQueue = new Queue('topicsQueue', { connection: connection as any });

// 2. Posts Queue
export const postsQueue = new Queue('postsQueue', { connection: connection as any });

// 3. Image Queue
export const imageQueue = new Queue('imageQueue', { connection: connection as any });
