"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageQueue = exports.postsQueue = exports.topicsQueue = exports.connection = exports.connectionOptions = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// We pass connection options rather than the pre-instantiated connection directly
// to avoid TypeScript errors where Bullmq's bundled ioredis types clash with the project's ioredis
exports.connectionOptions = {
    url: redisUrl,
    maxRetriesPerRequest: null,
};
// Also export a shared client for manual Redis things if ever needed
exports.connection = new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
});
// 1. Topics Queue 
exports.topicsQueue = new bullmq_1.Queue('topicsQueue', { connection: exports.connectionOptions });
// 2. Posts Queue
exports.postsQueue = new bullmq_1.Queue('postsQueue', { connection: exports.connectionOptions });
// 3. Image Queue
exports.imageQueue = new bullmq_1.Queue('imageQueue', { connection: exports.connectionOptions });
