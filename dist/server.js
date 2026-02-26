"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const fastify_1 = __importDefault(require("fastify"));
// Force restart for Prisma Client update
const telegram_service_1 = __importDefault(require("./services/telegram.service"));
const jobs_1 = __importDefault(require("./routes/jobs"));
const webhook_1 = __importDefault(require("./routes/webhook"));
const api_routes_1 = __importDefault(require("./routes/api.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const project_routes_1 = __importDefault(require("./routes/project.routes"));
const path_1 = __importDefault(require("path"));
// Crash Logging
process.on('uncaughtException', (err) => {
    const fs = require('fs');
    fs.appendFileSync('crash.log', `[${new Date().toISOString()}] Uncaught Exception: ${err.message}\n${err.stack}\n\n`);
    console.error('Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    const fs = require('fs');
    fs.appendFileSync('crash.log', `[${new Date().toISOString()}] Unhandled Rejection: ${reason}\n\n`);
    console.error('Unhandled Rejection:', reason);
});
// Global BigInt serialization fix for Prisma/Fastify
BigInt.prototype.toJSON = function () {
    return this.toString();
};
const server = (0, fastify_1.default)({
    logger: true
});
server.addHook('onRequest', (request, reply, done) => {
    console.log(`[Server] Incoming request: ${request.method} ${request.url}`);
    done();
});
server.register(require('@fastify/cors'), {
    origin: true
});
server.register(require('@fastify/formbody'));
server.register(require('@fastify/multipart'), {
    limits: {
        fieldNameSize: 100, // Max field name size in bytes
        fieldSize: 100, // Max field value size in bytes
        fields: 10, // Max number of non-file fields
        fileSize: 15 * 1024 * 1024, // 15MB
        files: 1, // Max number of file fields
        headerPairs: 2000 // Max number of header key=>value pairs
    }
});
server.register(require('@fastify/static'), {
    root: path_1.default.join(__dirname, '../frontend/dist'),
    prefix: '/',
});
server.register(require('@fastify/static'), {
    root: path_1.default.join(__dirname, '../uploads'),
    prefix: '/uploads/',
    decorateReply: false // Avoid conflict with previous registration
});
server.register(auth_routes_1.default);
server.register(project_routes_1.default);
server.register(api_routes_1.default);
server.register(webhook_1.default);
server.register(jobs_1.default);
// SPA fallback for non-API routes
server.setNotFoundHandler((request, reply) => {
    if (request.raw.url && request.raw.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not Found' });
        return;
    }
    reply.sendFile('index.html');
});
const publisher_service_1 = __importDefault(require("./services/publisher.service"));
const start = async () => {
    try {
        // Initialize Telegram Bot
        await telegram_service_1.default.launch();
        // Initialize Storage
        const storageService = require('./services/storage.service').default;
        await storageService.ensureBucketExists();
        const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3003;
        await server.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`Server is running on port ${PORT}`);
        // Internal Scheduler: Check for due posts every 60 seconds
        console.log('Starting internal scheduler (every 60s)...');
        setInterval(async () => {
            try {
                const count = await publisher_service_1.default.publishDuePosts();
                await publisher_service_1.default.scheduleNativePosts();
                if (count > 0) {
                    console.log(`[Scheduler] Published ${count} posts.`);
                }
            }
            catch (e) {
                console.error('[Scheduler] Error publishing due posts:', e);
            }
        }, 60000);
        // Run once immediately on startup
        publisher_service_1.default.publishDuePosts().catch(e => console.error('[Scheduler] Initial check failed:', e));
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
