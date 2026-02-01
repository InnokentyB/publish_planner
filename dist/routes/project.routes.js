"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = projectRoutes;
const auth_service_1 = __importDefault(require("../services/auth.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function projectRoutes(fastify) {
    // Middleware-like check for project routes
    fastify.addHook('preHandler', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Auth required' });
            return;
        }
        try {
            request.user = auth_service_1.default.verifyToken(token);
        }
        catch (e) {
            reply.code(401).send({ error: 'Invalid token' });
        }
    });
    // List user projects
    fastify.get('/api/projects', async (request, reply) => {
        const user = request.user;
        const projects = await auth_service_1.default.getUserProjects(user.id);
        return projects;
    });
    // Create project
    fastify.post('/api/projects', async (request, reply) => {
        const user = request.user;
        const { name, slug, description } = request.body;
        const project = await prisma.project.create({
            data: {
                name,
                slug,
                description,
                members: {
                    create: {
                        user_id: user.id,
                        role: 'owner'
                    }
                }
            }
        });
        return project;
    });
    // Get project details
    fastify.get('/api/projects/:id', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId);
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                channels: true,
                _count: { select: { weeks: true, members: true } }
            }
        });
        return project;
    });
    // Channels management
    fastify.post('/api/projects/:id/channels', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { type, name, config } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const channel = await prisma.socialChannel.create({
            data: {
                project_id: projectId,
                type,
                name,
                config
            }
        });
        return channel;
    });
}
