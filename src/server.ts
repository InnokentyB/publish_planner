import Fastify from 'fastify';
import { config } from 'dotenv';
import telegramService from './services/telegram.service';
import jobRoutes from './routes/jobs';
import telegramRoutes from './routes/webhook';

config();

const server = Fastify({
    logger: true
});

server.register(require('@fastify/formbody'));
server.register(telegramRoutes);
server.register(jobRoutes);

const start = async () => {
    try {
        // Initialize Telegram Bot
        await telegramService.launch();

        await server.listen({ port: 3000, host: '0.0.0.0' });
        console.log('Server is running on port 3000');
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
