import { FastifyInstance } from 'fastify';
import plannerService from '../services/planner.service';
import generatorService from '../services/generator.service';
import multiAgentService from '../services/multi_agent.service';
import publisherService from '../services/publisher.service';
import modelService from '../services/model.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

import authService from '../services/auth.service';
import commentService from '../services/comment.service';

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
        // Initial 5 slots
        await plannerService.generateSlots(week.id, projectId, start, 5, 0);

        return week;
    });

    fastify.get('/api/weeks/:id', async (request, reply) => {
        try {
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
                console.log('Week status is topics_generated, looking for run...');
                const run = await prisma.agentRun.findFirst({
                    where: { topic: `TOPICS: ${week.theme}` },
                    orderBy: { created_at: 'desc' },
                    include: { iterations: true }
                });
                if (run) {
                    console.log('Run found:', run.id);
                    // Noop
                }
            }

            console.log('Returning week:', week.id); // Debug Log

            // Sanitize BigInt for Fastify
            const serializedPosts = week.posts.map(p => ({
                ...p,
                approval_message_id: p.approval_message_id ? p.approval_message_id.toString() : null
            }));

            return { ...week, posts: serializedPosts, topics };
        } catch (e: any) {
            console.error('Error in GET /api/weeks/:id:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /weeks/${(request.params as any).id}: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
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
        try {
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
            const { promptPresetId, overwrite } = request.body as { promptPresetId?: number, overwrite?: boolean };

            const week = await prisma.week.findUnique({
                where: { id: parseInt(id) } // Removed project_id check temporarily to depend on middleware
            });

            // Double check project ownership if needed, or rely on middleware
            if (!week || week.project_id !== projectId) {
                return reply.code(404).send({ error: 'Week not found' });
            }

            // Handle Overwrite
            if (overwrite) {
                console.log(`[API] Overwriting topics for week ${id}`);
                await prisma.post.deleteMany({
                    where: {
                        week_id: week.id,
                        status: { in: ['planned', 'topics_generated'] } // Only delete planned/generated, keep published/scheduled? 
                        // Actually, if we regenerate topics, we probably want to wipe the slate for this week unless they are already locked in.
                    }
                });
            }

            let promptOverride: string | undefined;
            if (promptPresetId) {
                const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
                if (preset) promptOverride = preset.prompt_text;
            }

            // Determine how many topics to generate based on existing posts (topics)
            const existingPosts = await prisma.post.findMany({
                where: { week_id: week.id, status: { not: 'planned' } }, // Count generated/approved topics
                select: { topic: true }
            });
            const existingCount = existingPosts.length;
            const existingTopics = existingPosts.map(p => p.topic || '').filter(t => t);

            let countToGenerate = 0;
            // Target 14 topics (full week)
            if (existingCount < 14) {
                countToGenerate = 14 - existingCount;
            } else {
                return reply.code(400).send({ error: 'Maximum topics (14) already reached' });
            }

            if (countToGenerate <= 0) {
                return reply.code(400).send({ error: 'No topics needed or max reached' });
            }

            // Generate slots for new topics
            // We need to know where to start indexing. 
            // Assuming slots are 1-based index. 
            // Actually, we should check if slots already exist for these indices.
            // But simplify: just generate slots starting from current count.
            await plannerService.generateSlots(week.id, projectId, week.week_start, countToGenerate, existingCount);

            const result = await generatorService.generateTopics(projectId, week.theme, week.id, promptOverride, countToGenerate, existingTopics);

            // Save topics starting at the correct offset
            await plannerService.saveTopics(week.id, result.topics, existingCount);

            return { success: true, topics: result.topics };
        } catch (error: any) {
            console.error('[API Error] Generate Topics Failed:', error);
            const fs = require('fs');
            const logEntry = `[${new Date().toISOString()}] Error in /generate-topics: ${error.message}\nStack: ${error.stack}\n\n`;
            fs.appendFileSync('server_error.log', logEntry);
            return reply.code(500).send({ error: 'Internal Server Error', details: error.message });
        }
    });

    fastify.post('/api/weeks/:id/approve-topics', async (request, reply) => {
        const { id } = request.params as { id: string };
        const weekId = parseInt(id);

        // Update all posts status
        await prisma.post.updateMany({
            where: {
                week_id: weekId,
                status: 'topics_generated'
            },
            data: {
                status: 'topics_approved'
            }
        });

        await plannerService.updateWeekStatus(weekId, 'topics_approved');
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
                    const text = await generatorService.generatePostText(projectId, week.theme, post.topic, post.id);
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

    fastify.post('/api/posts/:id/generate-image', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const { provider } = request.body as { provider?: 'dalle' | 'nano' };

        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) }
        });

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        try {
            const textToUse = post.final_text || post.generated_text || post.topic || '';

            // 1. Generate Prompt
            const imagePrompt = await generatorService.generateImagePrompt(post.project_id, post.topic || 'Tech Post', textToUse, provider || 'dalle');

            // 2. Generate Image
            let imageUrl = '';
            if (provider === 'nano') {
                imageUrl = await generatorService.generateImageNanoBanana(imagePrompt);
            } else {
                imageUrl = await generatorService.generateImage(imagePrompt);
            }

            // 3. Save to DB
            await plannerService.updatePost(post.id, {
                image_url: imageUrl,
                image_prompt: imagePrompt
            });

            return { success: true, imageUrl, imagePrompt };
        } catch (error: any) {
            request.log.error(error);
            console.error('Error generating image:', error);
            return reply.status(500).send({ error: `Image Generation failed: ${error.message || error}` });
        }
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

    fastify.post('/api/posts/:id/approve-topic', async (request, reply) => {
        const { id } = request.params as { id: string };
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: { status: 'topics_approved' }
        });
        return post;
    });


    fastify.post('/api/posts/:id/publish-now', async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
            await publisherService.publishPostNow(parseInt(id));
            return { success: true };
        } catch (e: any) {
            console.error('Publish now failed', e);
            reply.code(500).send({ error: e.message });
        }
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

        const { promptPresetId, withImage } = request.body as { promptPresetId?: number, withImage?: boolean };
        let promptOverride: string | undefined;
        if (promptPresetId) {
            const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
            if (preset) promptOverride = preset.prompt_text;
        }

        const result = await generatorService.generatePostText(projectId, post.week.theme, post.topic, post.id, promptOverride, withImage);

        let fullText = result.text;
        if (result.tags && result.tags.length > 0) {
            fullText += '\n\n' + result.tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
        } else if (post.category) { // Fallback to existing category if new tags fail
            fullText += `\n\n#${post.category.replace(/\s+/g, '')}`;
        }

        const updated = await prisma.post.update({
            where: { id: post.id },
            data: {
                generated_text: fullText,
                final_text: fullText,
                status: 'generated',
                category: result.category || undefined,
                tags: result.tags || undefined
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

        // Text Agents
        for (const role of roles) {
            const config = await multiAgentService.getAgentConfig(projectId, role as any);

            let provider = 'Not Configured';
            if (config.apiKey) {
                if (config.apiKey.startsWith('sk-ant')) provider = 'Anthropic';
                else if (config.apiKey.startsWith('AIza')) provider = 'Gemini';
                else if (config.apiKey.startsWith('sk-')) provider = 'OpenAI';
                else provider = 'Unknown';
            }

            agents.push({
                role,
                prompt: config.prompt,
                apiKey: config.apiKey,
                model: config.model,
                provider
            });
        }

        // Image Agents (DALL-E)
        const dallePrompt = await generatorService.getImagePromptTemplate(projectId, 'dalle');
        agents.push({
            role: 'dalle_image_gen',
            prompt: dallePrompt,
            apiKey: '', // Managed via env mostly for now
            model: 'dall-e-3',
            provider: 'OpenAI (Env)'
        });

        // Image Agents (Nano)
        const nanoPrompt = await generatorService.getImagePromptTemplate(projectId, 'nano');
        agents.push({
            role: 'nano_image_gen',
            prompt: nanoPrompt,
            apiKey: '',
            model: 'imagen-3.0',
            provider: 'Google (Env)'
        });

        return agents;
    });

    fastify.put('/api/settings/agents/:role', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { role } = request.params as { role: string };
        const { prompt, apiKey, model } = request.body as { prompt: string; apiKey: string; model: string };

        // Handle Image Agents
        if (role === 'dalle_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'dalle');
            return { success: true };
        }
        if (role === 'nano_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'nano');
            return { success: true };
        }

        // Handle Text Agents
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
        return runs;
    });

    // Agents Presets
    fastify.get('/api/settings/presets', async (request, reply) => {
        try {
            const projectId = (request as any).projectId;
            if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

            return await prisma.promptPreset.findMany({
                where: { project_id: projectId },
                orderBy: { created_at: 'desc' }
            });
        } catch (e: any) {
            console.error('Error in GET /api/settings/presets:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /presets: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.post('/api/settings/presets', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { name, role, prompt_text } = request.body as any;

        return await prisma.promptPreset.create({
            data: { project_id: projectId, name, role, prompt_text }
        });
    });

    fastify.put('/api/settings/presets/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const data = request.body as any;

        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        return await prisma.promptPreset.update({
            where: { id: parseInt(id) },
            data
        });
    });

    fastify.delete('/api/settings/presets/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        await prisma.promptPreset.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });

    // Comments
    fastify.get('/api/comments', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { entityType, entityId } = request.query as { entityType: string, entityId: string };
        if (!entityType || !entityId) return reply.code(400).send({ error: 'Missing params' });

        return await commentService.getComments(projectId, entityType, parseInt(entityId));
    });

    fastify.post('/api/comments', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { entityType, entityId, text } = request.body as any;

        return await commentService.createComment(projectId, entityType, parseInt(entityId), text, 'user');
    });

    // Keys Management
    fastify.get('/api/settings/keys', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const keys = await prisma.providerKey.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' }
        });

        // Mask keys
        return keys.map(k => ({
            ...k,
            key: k.key.substring(0, 3) + '...' + k.key.substring(k.key.length - 4)
        }));
    });

    fastify.post('/api/settings/keys', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { name, key } = request.body as { name: string; key: string };

        let provider = 'Other';
        if (key.startsWith('sk-ant')) provider = 'Anthropic';
        else if (key.startsWith('AIza')) provider = 'Gemini';
        else if (key.startsWith('sk-')) provider = 'OpenAI';

        const newKey = await prisma.providerKey.create({
            data: {
                project_id: projectId,
                name,
                key,
                provider
            }
        });

        return { success: true, id: newKey.id, provider: newKey.provider };
    });

    fastify.delete('/api/settings/keys/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        // Ensure belongs to project
        const count = await prisma.providerKey.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        await prisma.providerKey.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });

    // Model Fetching
    fastify.get('/api/settings/models', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { provider, keyId, key } = request.query as { provider?: string, keyId?: string, key?: string };

        let apiKey = key;
        let detectedProvider = provider || 'Unknown';

        // If keyId is provided, fetch from DB
        if (keyId) {
            const storedKey = await prisma.providerKey.findFirst({
                where: { id: parseInt(keyId), project_id: projectId }
            });
            if (storedKey) {
                apiKey = storedKey.key;
                detectedProvider = storedKey.provider;
            }
        }

        if (!apiKey) return reply.code(400).send({ error: 'API Key required' });

        // Auto-detect provider if missing
        if (!detectedProvider || detectedProvider === 'Unknown') {
            if (apiKey.startsWith('sk-ant')) detectedProvider = 'Anthropic';
            else if (apiKey.startsWith('AIza')) detectedProvider = 'Gemini';
            else if (apiKey.startsWith('sk-')) detectedProvider = 'OpenAI';
        }

        const models = await modelService.fetchModels(detectedProvider, apiKey);
        return { models };
    });
}
