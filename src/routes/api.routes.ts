import { FastifyInstance } from 'fastify';
import plannerService from '../services/planner.service';
import generatorService from '../services/generator.service';
import multiAgentService from '../services/multi_agent.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

import authService from '../services/auth.service';

export default async function apiRoutes(fastify: FastifyInstance) {
    // Auth and Project context middleware
    fastify.addHook('preHandler', async (request, reply) => {
        // Skip auth for static files if needed, but here we cover /api/
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Authentication required' });
            return;
        }

        try {
            const user = authService.verifyToken(token);
            (request as any).user = user;

            const projectId = request.headers['x-project-id'];
            if (projectId) {
                const pid = parseInt(projectId as string);
                const hasAccess = await authService.hasProjectAccess(user.id, pid);
                if (!hasAccess) {
                    reply.code(403).send({ error: 'No access to this project' });
                    return;
                }
                (request as any).projectId = pid;
            }
        } catch (e) {
            reply.code(401).send({ error: 'Invalid or expired token' });
        }
    });

    // Weeks
    fastify.get('/api/weeks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const weeks = await prisma.week.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { posts: true } } }
        });
        return weeks;
    });

    fastify.post('/api/weeks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { theme, startDate } = request.body as { theme: string; startDate?: string };

        let start, end;
        if (startDate) {
            const date = new Date(startDate);
            const range = await plannerService.getWeekRangeForDate(date);
            start = range.start;
            end = range.end;
        } else {
            const range = await plannerService.getNextWeekRange();
            start = range.start;
            end = range.end;
        }

        const week = await plannerService.createWeek(projectId, theme, start, end);
        await plannerService.generateSlots(week.id, projectId, start);

        return week;
    });

    fastify.get('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id) },
            include: { posts: true }
        });

        if (!week) {
            reply.code(404).send({ error: 'Week not found' });
            return;
        }

        // Get topics if in topics_generated status
        let topics = null;
        if (week.status === 'topics_generated') {
            const topicPosts = await prisma.post.findMany({
                where: { week_id: week.id },
                select: { topic: true, category: true, tags: true }
            });
            topics = topicPosts.map(p => ({ topic: p.topic, category: p.category, tags: p.tags }));
        }

        return { ...week, topics };
    });

    fastify.put('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = request.body as any;

        const week = await prisma.week.update({
            where: { id: parseInt(id) },
            data
        });

        return week;
    });

    fastify.delete('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        await prisma.week.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });

    // Week actions
    fastify.post('/api/weeks/:id/generate-topics', async (request, reply) => {
        const projectId = (request as any).projectId;
        console.log('[API] Generate Topics Request:', {
            projectId,
            params: request.params,
            headers_x_project_id: request.headers['x-project-id']
        });

        if (!projectId) {
            console.error('[API] Missing Project ID');
            return reply.code(400).send({ error: 'Project ID required' });
        }

        const { id } = request.params as { id: string };
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!week) {
            reply.code(404).send({ error: 'Week not found' });
            return;
        }

        const result = await generatorService.generateTopics(projectId, week.theme);
        await plannerService.saveTopics(week.id, result.topics);

        return { success: true, topics: result.topics };
    });

    fastify.post('/api/weeks/:id/approve-topics', async (request, reply) => {
        const { id } = request.params as { id: string };
        await plannerService.updateWeekStatus(parseInt(id), 'topics_approved');
        return { success: true };
    });

    fastify.post('/api/weeks/:id/generate-posts', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: { posts: true }
        });

        if (!week) {
            reply.code(404).send({ error: 'Week not found' });
            return;
        }

        await plannerService.updateWeekStatus(week.id, 'generating');

        // Generate posts asynchronously
        (async () => {
            for (const post of week.posts) {
                if (!post.topic) continue;

                try {
                    const text = await generatorService.generatePostText(projectId, week.theme, post.topic);
                    const hashtag = post.category ? `\n\n#${post.category.replace(/\s+/g, '')}` : '';
                    const fullText = text + hashtag;

                    await plannerService.updatePost(post.id, {
                        generated_text: fullText,
                        final_text: fullText,
                        status: 'generated'
                    });
                } catch (err) {
                    console.error(`Error generating post ${post.id}:`, err);
                }
            }

            await plannerService.updateWeekStatus(week.id, 'generated');
        })();

        return { success: true, message: 'Generation started' };
    });

    // Posts
    fastify.get('/api/posts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) }
        });

        if (!post) {
            reply.code(404).send({ error: 'Post not found' });
            return;
        }

        return post;
    });

    fastify.put('/api/posts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = request.body as any;

        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data
        });

        return post;
    });

    fastify.post('/api/posts/:id/approve', async (request, reply) => {
        const { id } = request.params as { id: string };
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: { status: 'scheduled' }
        });

        return post;
    });

    fastify.post('/api/posts/:id/generate', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const post = await prisma.post.findFirst({
            where: {
                id: parseInt(id),
                week: { project_id: projectId }
            },
            include: { week: true }
        });

        if (!post || !post.week) {
            reply.code(404).send({ error: 'Post not found or access denied' });
            return;
        }

        if (!post.topic) {
            reply.code(400).send({ error: 'Post has no topic' });
            return;
        }

        const text = await generatorService.generatePostText(projectId, post.week.theme, post.topic);
        const hashtag = post.category ? `\n\n#${post.category.replace(/\s+/g, '')}` : '';
        const fullText = text + hashtag;

        const updated = await prisma.post.update({
            where: { id: post.id },
            data: {
                generated_text: fullText,
                final_text: fullText,
                status: 'generated'
            }
        });

        return updated;
    });

    // Settings
    fastify.get('/api/settings/agents', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const roles = ['post_creator', 'post_critic', 'post_fixer', 'topic_creator', 'topic_critic', 'topic_fixer'];
        const agents = [];

        for (const role of roles) {
            const config = await multiAgentService.getAgentConfig(projectId, role as any);
            agents.push({
                role,
                prompt: config.prompt,
                apiKey: config.apiKey,
                model: config.model
            });
        }

        return agents;
    });

    fastify.put('/api/settings/agents/:role', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { role } = request.params as { role: string };
        const { prompt, apiKey, model } = request.body as { prompt: string; apiKey: string; model: string };

        const roleMap: any = {
            'post_creator': { prompt: 'multi_agent_post_creator_prompt', key: 'multi_agent_post_creator_key', model: 'multi_agent_post_creator_model' },
            'post_critic': { prompt: 'multi_agent_post_critic_prompt', key: 'multi_agent_post_critic_key', model: 'multi_agent_post_critic_model' },
            'post_fixer': { prompt: 'multi_agent_post_fixer_prompt', key: 'multi_agent_post_fixer_key', model: 'multi_agent_post_fixer_model' },
            'topic_creator': { prompt: 'multi_agent_topic_creator', key: 'multi_agent_topic_creator_key', model: 'multi_agent_topic_creator_model' },
            'topic_critic': { prompt: 'multi_agent_topic_critic', key: 'multi_agent_topic_critic_key', model: 'multi_agent_topic_critic_model' },
            'topic_fixer': { prompt: 'multi_agent_topic_fixer', key: 'multi_agent_topic_fixer_key', model: 'multi_agent_topic_fixer_model' }
        };

        const keys = roleMap[role];
        if (!keys) {
            reply.code(400).send({ error: 'Invalid role' });
            return;
        }

        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: keys.prompt } },
            update: { value: prompt },
            create: { project_id: projectId, key: keys.prompt, value: prompt }
        });

        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: keys.key } },
            update: { value: apiKey },
            create: { project_id: projectId, key: keys.key, value: apiKey || '' }
        });

        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: keys.model } },
            update: { value: model },
            create: { project_id: projectId, key: keys.model, value: model }
        });

        return { success: true };
    });

    fastify.get('/api/settings/runs', async (request, reply) => {
        const runs = await prisma.agentRun.findMany({
            orderBy: { created_at: 'desc' },
            take: 50
        });

        return runs;
    });
}
