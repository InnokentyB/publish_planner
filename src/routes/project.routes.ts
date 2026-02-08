import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default async function projectRoutes(fastify: FastifyInstance) {
    // Middleware-like check for project routes
    fastify.addHook('preHandler', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Auth required' });
            return;
        }
        try {
            (request as any).user = authService.verifyToken(token);
        } catch (e) {
            reply.code(401).send({ error: 'Invalid token' });
        }
    });

    // List user projects
    fastify.get('/api/projects', async (request, reply) => {
        const user = (request as any).user;
        const projects = await authService.getUserProjects(user.id);
        return projects;
    });

    // Create project
    fastify.post('/api/projects', async (request, reply) => {
        const user = (request as any).user;
        const { name, slug, description } = request.body as any;

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
        const user = (request as any).user;
        const { id } = request.params as any;
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId);
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                channels: true,
                _count: { select: { weeks: true } }, // Removed members count as we fetch list
                members: {
                    include: { user: { select: { id: true, name: true, email: true } } }
                }
            }
        });

        return project;
    });

    // Channels management
    fastify.post('/api/projects/:id/channels', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { type, name, config } = request.body as any;
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
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
    fastify.put('/api/projects/:id', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { name, description } = request.body as any;
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can edit project details' });
            return;
        }

        const project = await prisma.project.update({
            where: { id: projectId },
            data: { name, description }
        });

        return project;
    });

    // Members management
    fastify.post('/api/projects/:id/members', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { email, role } = request.body as any; // role: editor, viewer
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can add members' });
            return;
        }

        // Find user by email
        const targetUser = await prisma.user.findUnique({ where: { email } });
        if (!targetUser) {
            return reply.code(404).send({ error: 'User not found' });
        }

        // Check if already member
        const existing = await prisma.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: targetUser.id } }
        });

        if (existing) {
            return reply.code(400).send({ error: 'User already in project' });
        }

        const member = await prisma.projectMember.create({
            data: {
                project_id: projectId,
                user_id: targetUser.id,
                role: role || 'viewer'
            },
            include: { user: { select: { id: true, name: true, email: true } } }
        });

        return member;
    });

    fastify.delete('/api/projects/:id/members/:userId', async (request, reply) => {
        const user = (request as any).user;
        const { id, userId } = request.params as any;
        const projectId = parseInt(id);
        const targetUserId = parseInt(userId);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can remove members' });
            return;
        }

        if (user.id === targetUserId) {
            return reply.code(400).send({ error: 'Cannot remove yourself' });
        }

        await prisma.projectMember.delete({
            where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } }
        });

        return { success: true };
    });
}

