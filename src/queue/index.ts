import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

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
        console.log('--- LOCAL DEV HINT ---');
        console.log('It looks like Redis is not running. Please start it with:');
        console.log('docker-compose up -d redis');
        console.log('----------------------');
    } else {
        console.error('[Redis] Connection Error:', err);
    }
});

connection.on('connect', () => {
    console.log('[Redis] Connected to:', redisUrl.replace(/:[^:]*@/, ':***@')); // Hide password in logs
});

// 1. Topics Queue 
export const topicsQueue = new Queue('topicsQueue', { connection: connection as any });

// 2. Posts Queue
export const postsQueue = new Queue('postsQueue', { connection: connection as any });

// 3. Image Queue
export const imageQueue = new Queue('imageQueue', { connection: connection as any });
