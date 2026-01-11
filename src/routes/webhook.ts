import { FastifyInstance } from 'fastify';
import telegramService from '../services/telegram.service';

export default async function telegramRoutes(fastify: FastifyInstance) {
    fastify.post('/telegram/webhook', async (request, reply) => {
        try {
            await telegramService.handleUpdate(request.body);
            return { status: 'ok' };
        } catch (e) {
            console.error(e);
            return { status: 'error' };
        }
    });
}
