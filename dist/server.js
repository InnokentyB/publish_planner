"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./bootstrap-env");
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
const linkedin_routes_1 = __importDefault(require("./routes/linkedin.routes"));
const path_1 = __importDefault(require("path"));
const health_service_1 = __importDefault(require("./services/health.service"));
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
    if (process.env.REQUEST_LOGGING_ENABLED === 'true') {
        console.log(`[Server] Incoming request: ${request.method} ${request.url}`);
    }
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
// Public health-check endpoint – used by Playwright webServer to probe readiness
server.get('/api/health', async (_request, _reply) => {
    return health_service_1.default.getBasicHealth();
});
server.get('/api/health/deep', async (_request, reply) => {
    const result = await health_service_1.default.getDeepHealth();
    if (result.status === 'error') {
        return reply.code(503).send(result);
    }
    return result;
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
server.register(linkedin_routes_1.default);
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
        try {
            await telegram_service_1.default.launch();
        }
        catch (error) {
            console.error('[Startup] Telegram initialization failed:', error);
        }
        // Initialize Storage
        const storageService = require('./services/storage.service').default;
        try {
            await storageService.ensureBucketExists();
        }
        catch (error) {
            console.error('[Startup] Storage initialization failed:', error);
        }
        const startupHealth = await health_service_1.default.getDeepHealth().catch((error) => ({
            status: 'error',
            message: error?.message || 'Startup health check failed'
        }));
        console.log('[Startup] Dependency health snapshot:', JSON.stringify(startupHealth));
        const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3003;
        await server.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`Server is running on port ${PORT}`);
        // Internal Scheduler: Check for due posts every 60 seconds
        console.log('Starting internal scheduler (every 60s)...');
        setInterval(async () => {
            try {
                const count = await publisher_service_1.default.publishDuePosts();
                const createdRuleTasks = await publisher_service_1.default.processPublicationOngoingRules();
                const processedOperationalTasks = await publisher_service_1.default.processOperationalTasks();
                const reactivatedDeferred = await publisher_service_1.default.processDeferredPublicationTasks();
                const preparedTasks = await publisher_service_1.default.processPublicationTasks();
                await publisher_service_1.default.scheduleNativePosts();
                if (count > 0) {
                    console.log(`[Scheduler] Published ${count} posts.`);
                }
                if (createdRuleTasks > 0) {
                    console.log(`[Scheduler] Created ${createdRuleTasks} ongoing rule tasks.`);
                }
                if (processedOperationalTasks > 0) {
                    console.log(`[Scheduler] Processed ${processedOperationalTasks} internal operational tasks.`);
                }
                if (reactivatedDeferred > 0) {
                    console.log(`[Scheduler] Reactivated ${reactivatedDeferred} deferred publication tasks.`);
                }
                if (preparedTasks > 0) {
                    console.log(`[Scheduler] Prepared ${preparedTasks} publication tasks.`);
                }
            }
            catch (e) {
                console.error('[Scheduler] Error publishing due posts:', e);
            }
        }, 60000);
        // Run once immediately on startup
        publisher_service_1.default.publishDuePosts().catch(e => console.error('[Scheduler] Initial check failed:', e));
        publisher_service_1.default.processPublicationOngoingRules().catch(e => console.error('[Scheduler] Initial ongoing-rules check failed:', e));
        publisher_service_1.default.processOperationalTasks().catch(e => console.error('[Scheduler] Initial operational-task check failed:', e));
        publisher_service_1.default.processDeferredPublicationTasks().catch(e => console.error('[Scheduler] Initial deferred-task check failed:', e));
        publisher_service_1.default.processPublicationTasks().catch(e => console.error('[Scheduler] Initial publication task check failed:', e));
        // Setup metrics collector schedule (run every 12 hours)
        const metricsService = require('./services/metrics.service').default;
        // 12 hours in milliseconds = 12 * 60 * 60 * 1000 = 43200000
        console.log('Starting metrics collection scheduler (every 12h)...');
        setInterval(async () => {
            console.log('[MetricsService] Triggering scheduled metrics collection...');
            await metricsService.collectAllMetrics();
        }, 43200000);
        // Optionally run once on startup, 
        // using setTimeout to delay it by a few minutes to not block initial startup
        setTimeout(() => {
            console.log('[MetricsService] Running initial post-startup metrics collection check...');
            metricsService.collectAllMetrics().catch((e) => console.error('Initial metrics check failed:', e));
        }, 30000); // 30 seconds after boot
        // Initialize Background Workers (BullMQ)
        console.log('[Queue] Initializing background workers...');
        // const { createTopicWorker } = require('./queue/workers/topicWorker');
        // const { createPostWorker } = require('./queue/workers/postWorker');
        // const { createImageWorker } = require('./queue/workers/imageWorker');
        // const topicWorker = createTopicWorker();
        // const postWorker = createPostWorker();
        // const imageWorker = createImageWorker();
        // Graceful Shutdown block for Railway deployments
        const gracefulShutdown = async (signal) => {
            console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
            // 1. Stop Fastify
            await server.close();
            console.log('[Server] Fastify closed.');
            // 2. Shut down workers (Wait for active jobs to finish)
            console.log('[Queue] Gracefully shutting down workers (Waiting for active jobs)...');
            // await Promise.allSettled([
            //     topicWorker.close(),
            //     postWorker.close(),
            //     imageWorker.close()
            // ]);
            console.log('[Queue] Workers successfully shut down.');
            // 3. Close generic Redis
            const { connection } = require('./queue/index');
            await connection.quit();
            console.log('[Server] Graceful shutdown complete. Exiting.');
            process.exit(0);
        };
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
