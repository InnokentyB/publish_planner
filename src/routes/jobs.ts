import { FastifyInstance } from 'fastify';
import plannerService from '../services/planner.service';
import publisherService from '../services/publisher.service';
import telegramService from '../services/telegram.service';

export default async function jobRoutes(fastify: FastifyInstance) {
    fastify.post('/jobs/weekly-planning', async (request, reply) => {
        const ownerId = process.env.OWNER_CHAT_ID;
        if (!ownerId) return reply.status(500).send({ error: 'OWNER_CHAT_ID not set' });

        await telegramService.sendMessage(ownerId, 'Привет! Пора планировать контент на следующую неделю. Пришлите основную тему или направление.');

        return { success: true };
    });

    fastify.post('/jobs/publish-due', async (request, reply) => {
        const count = await publisherService.publishDuePosts();
        return { success: true, published_count: count };
    });
}
