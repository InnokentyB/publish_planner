"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = authRoutes;
const auth_service_1 = __importDefault(require("../services/auth.service"));
async function authRoutes(fastify) {
    fastify.post('/api/auth/register', async (request, reply) => {
        const { email, password, name } = request.body;
        try {
            const result = await auth_service_1.default.register(email, password, name);
            return result;
        }
        catch (e) {
            reply.code(400).send({ error: e.message });
        }
    });
    fastify.post('/api/auth/login', async (request, reply) => {
        const { email, password } = request.body;
        try {
            const result = await auth_service_1.default.login(email, password);
            return result;
        }
        catch (e) {
            reply.code(401).send({ error: e.message });
        }
    });
    fastify.get('/api/auth/me', async (request, reply) => {
        try {
            const token = request.headers.authorization?.split(' ')[1];
            if (!token)
                throw new Error('No token');
            const user = auth_service_1.default.verifyToken(token);
            const projects = await auth_service_1.default.getUserProjects(user.id);
            return { user, projects };
        }
        catch (e) {
            reply.code(401).send({ error: e.message });
        }
    });
}
