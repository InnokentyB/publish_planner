"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = telegramRoutes;
const telegram_service_1 = __importDefault(require("../services/telegram.service"));
async function telegramRoutes(fastify) {
    fastify.post('/telegram/webhook', async (request, reply) => {
        try {
            await telegram_service_1.default.handleUpdate(request.body);
            return { status: 'ok' };
        }
        catch (e) {
            console.error(e);
            return { status: 'error' };
        }
    });
}
