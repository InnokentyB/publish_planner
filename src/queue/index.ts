import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Passed to Workers/Queues
export const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
    console.error('[Redis] Connection Error:', err);
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
