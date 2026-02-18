import { config } from 'dotenv';
config();

import Fastify from 'fastify';
// Force restart for Prisma Client update
import telegramService from './services/telegram.service';
import jobRoutes from './routes/jobs';
import telegramRoutes from './routes/webhook';
import apiRoutes from './routes/api.routes';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import path from 'path';


// Crash Logging
process.on('uncaughtException', (err) => {
    const fs = require('fs');
    fs.appendFileSync('crash.log', `[${new Date().toISOString()}] Uncaught Exception: ${err.message}\n${err.stack}\n\n`);
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise) => {
    const fs = require('fs');
    fs.appendFileSync('crash.log', `[${new Date().toISOString()}] Unhandled Rejection: ${reason}\n\n`);
    console.error('Unhandled Rejection:', reason);
});

// Global BigInt serialization fix for Prisma/Fastify
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

const server = Fastify({
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
server.register(require('@fastify/multipart'));
server.register(require('@fastify/static'), {
    root: path.join(__dirname, '../frontend/dist'),
    prefix: '/',
});

server.register(require('@fastify/static'), {
    root: path.join(__dirname, '../uploads'),
    prefix: '/uploads/',
    decorateReply: false // Avoid conflict with previous registration
});
server.register(authRoutes);
server.register(projectRoutes);
server.register(apiRoutes);
server.register(telegramRoutes);
server.register(jobRoutes);


// SPA fallback for non-API routes
server.setNotFoundHandler((request, reply) => {
    if (request.raw.url && request.raw.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not Found' });
        return;
    }
    (reply as any).sendFile('index.html');
});

import publisherService from './services/publisher.service';

const start = async () => {
    try {
        // Initialize Telegram Bot
        await telegramService.launch();

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
                const count = await publisherService.publishDuePosts();
                if (count > 0) {
                    console.log(`[Scheduler] Published ${count} posts.`);
                }
            } catch (e) {
                console.error('[Scheduler] Error publishing due posts:', e);
            }
        }, 60000);

        // Run once immediately on startup
        publisherService.publishDuePosts().catch(e => console.error('[Scheduler] Initial check failed:', e));

    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
