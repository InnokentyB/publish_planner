import Fastify from 'fastify';
import { config } from 'dotenv';
import telegramService from './services/telegram.service';
import jobRoutes from './routes/jobs';
import telegramRoutes from './routes/webhook';
import apiRoutes from './routes/api.routes';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import path from 'path';

config();

const server = Fastify({
    logger: true
});

server.register(require('@fastify/cors'), {
    origin: true
});
server.register(require('@fastify/formbody'));
server.register(require('@fastify/static'), {
    root: path.join(__dirname, '../frontend/dist'),
    prefix: '/',
});
server.register(authRoutes);
server.register(projectRoutes);
server.register(apiRoutes);
server.register(telegramRoutes);
server.register(jobRoutes);

import publisherService from './services/publisher.service';

const start = async () => {
    try {
        // Initialize Telegram Bot
        await telegramService.launch();

        await server.listen({ port: 3000, host: '0.0.0.0' });
        console.log('Server is running on port 3000');

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
