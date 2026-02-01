import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';

export default async function authRoutes(fastify: FastifyInstance) {
    fastify.post('/api/auth/register', async (request, reply) => {
        const { email, password, name } = request.body as any;
        try {
            const result = await authService.register(email, password, name);
            return result;
        } catch (e: any) {
            reply.code(400).send({ error: e.message });
        }
    });

    fastify.post('/api/auth/login', async (request, reply) => {
        const { email, password } = request.body as any;
        try {
            const result = await authService.login(email, password);
            return result;
        } catch (e: any) {
            reply.code(401).send({ error: e.message });
        }
    });

    fastify.get('/api/auth/me', async (request, reply) => {
        try {
            const token = request.headers.authorization?.split(' ')[1];
            if (!token) throw new Error('No token');

            const user = authService.verifyToken(token);
            const projects = await authService.getUserProjects(user.id);

            return { user, projects };
        } catch (e: any) {
            reply.code(401).send({ error: e.message });
        }
    });
}
