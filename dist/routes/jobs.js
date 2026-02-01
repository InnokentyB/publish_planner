"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = jobRoutes;
const publisher_service_1 = __importDefault(require("../services/publisher.service"));
const telegram_service_1 = __importDefault(require("../services/telegram.service"));
async function jobRoutes(fastify) {
    fastify.post('/jobs/weekly-planning', async (request, reply) => {
        const ownerId = process.env.OWNER_CHAT_ID;
        if (!ownerId)
            return reply.status(500).send({ error: 'OWNER_CHAT_ID not set' });
        await telegram_service_1.default.sendMessage(ownerId, 'Привет! Пора планировать контент на следующую неделю. Пришлите основную тему или направление.');
        return { success: true };
    });
    fastify.post('/jobs/publish-due', async (request, reply) => {
        const count = await publisher_service_1.default.publishDuePosts();
        return { success: true, published_count: count };
    });
}
