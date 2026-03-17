import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// We pass connection options rather than the pre-instantiated connection directly
// to avoid TypeScript errors where Bullmq's bundled ioredis types clash with the project's ioredis
export const connectionOptions = {
    url: redisUrl,
    maxRetriesPerRequest: null,
};

// Also export a shared client for manual Redis things if ever needed
export const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null, 
});

// 1. Topics Queue 
export const topicsQueue = new Queue('topicsQueue', { connection: connectionOptions as any });

// 2. Posts Queue
export const postsQueue = new Queue('postsQueue', { connection: connectionOptions as any });

// 3. Image Queue
export const imageQueue = new Queue('imageQueue', { connection: connectionOptions as any });
