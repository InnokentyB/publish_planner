"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageQueue = exports.postsQueue = exports.topicsQueue = exports.connection = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// Passed to Workers/Queues
exports.connection = new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
});
exports.connection.on('error', (err) => {
    console.error('[Redis] Connection Error:', err);
});
exports.connection.on('connect', () => {
    console.log('[Redis] Connected to:', redisUrl.replace(/:[^:]*@/, ':***@')); // Hide password in logs
});
// 1. Topics Queue 
exports.topicsQueue = new bullmq_1.Queue('topicsQueue', { connection: exports.connection });
// 2. Posts Queue
exports.postsQueue = new bullmq_1.Queue('postsQueue', { connection: exports.connection });
// 3. Image Queue
exports.imageQueue = new bullmq_1.Queue('imageQueue', { connection: exports.connection });
