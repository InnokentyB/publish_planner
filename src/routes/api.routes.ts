import { FastifyInstance } from 'fastify';
import plannerService from '../services/planner.service';
import generatorService from '../services/generator.service';
import multiAgentService from '../services/multi_agent.service';
import publisherService from '../services/publisher.service';
import modelService from '../services/model.service';
import v2Orchestrator from '../services/v2_orchestrator.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

import authService from '../services/auth.service';
import commentService from '../services/comment.service';
import storageService from '../services/storage.service';
import contentDictionaryService from '../services/content_dictionary.service';
import publicationPlanService from '../services/publication_plan.service';

async function loadPublicationPlanContext(projectId: number) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts'] }
        }
    });

    const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
    const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
    const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;

    if (!meta || !assets || !accounts) {
        return null;
    }

    return {
        meta: JSON.parse(meta),
        assets: JSON.parse(assets),
        accounts: JSON.parse(accounts),
        actions: [] as any[]
    };
}

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

        try {
            const week = await plannerService.createWeek(projectId, theme, start, end);
            // Default: All 7 days (14 slots)
            await plannerService.generateSlots(week.id, projectId, start, 14, 0);
            return week;
        } catch (e: any) {
            // P2002 is Prisma Unique Constraint Violation
            if (e.code === 'P2002') {
                console.log(`[API] Week already exists for project ${projectId} and start ${start}. Returning existing.`);
                const existing = await prisma.week.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: start,
                        week_end: end
                    },
                    include: { _count: { select: { posts: true } } }
                });
                return existing;
            }
            console.error('[API] Error creating week:', e);
            reply.code(500).send({ error: 'Failed to create week', details: e.message });
        }
    });

    fastify.get('/api/weeks/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };
            const week = await prisma.week.findUnique({
                where: { id: parseInt(id) },
                include: {
                    posts: {
                        orderBy: { publish_at: 'asc' }
                    }
                }
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
                    where: { input: `Theme: ${week.theme}` },
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
            const serializedPosts = week.posts.map((p: any) => ({
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
            // Push to queue instead of running inline
            const { topicsQueue } = require('../queue');
            await topicsQueue.add('generate-topics', {
                projectId,
                weekId: week.id,
                promptOverride,
                countToGenerate,
                existingCount,
                existingTopics
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            });

            return reply.code(202).send({ success: true, message: 'Topics generation queued in background' });
        } catch (error: any) {
            console.error('[API Error] Generate Topics Failed API setup:', error);
            const fs = require('fs');
            const logEntry = `[${new Date().toISOString()}] Error in /generate-topics API: ${error.message}\nStack: ${error.stack}\n\n`;
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

        // Generate posts asynchronously via BullMQ Queue
        const { postsQueue } = require('../queue');
        
        for (const post of week.posts) {
            if (!post.topic) continue;

            await prisma.post.update({
                where: { id: post.id },
                data: { status: 'generating' }
            });

            await postsQueue.add('generate-post', {
                projectId,
                theme: week.theme,
                topic: post.topic,
                postId: post.id,
                isBatch: true // Identifies we should check if entire week is done
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 10000 }
            });
        }

        return reply.code(202).send({ success: true, message: 'Generation queued' });
    });

    fastify.post('/api/weeks/:id/generate-sequential', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        const week = await prisma.week.findUnique({
            where: { id: parseInt(id) }
        });

        if (!week) return reply.code(404).send({ error: 'Week not found' });

        // Trigger background generation
        (async () => {
            const writer = require('../services/sequential_writer.service').default;
            try {
                await writer.generateWeekPosts(projectId, week.id);
            } catch (e) {
                console.error('Sequential generation failed', e);
            }
        })();

        return { success: true, message: 'Sequential generation started' };
    });

    fastify.post('/api/posts/:id/generate-image', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const { provider } = request.body as { provider?: 'gpt-image' | 'nano' | 'full' };

        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) }
        });

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        try {
            console.log(`[Generate Image] Enqueueing request for Post ${id}, Provider: ${provider || 'gpt-image'}`);
            const textToUse = post.final_text || post.generated_text || post.topic || '';
            
            // Mark immediately to stop re-clicks
            await prisma.post.update({
                where: { id: parseInt(id) },
                data: { status: 'generating' }
            });

            const { imageQueue } = require('../queue');
            await imageQueue.add('generate-image', {
                projectId,
                postId: post.id,
                provider: provider || 'gpt-image',
                textToUse,
                topic: post.topic
            }, {
                attempts: 2,
                backoff: { type: 'exponential', delay: 10000 }
            });

            return reply.code(202).send({ success: true, message: 'Image generation queued' });
        } catch (error: any) {
            request.log.error(error);
            return reply.code(500).send({ error: `Queue failed: ${error.message}` });
        }
    });

    fastify.post('/api/posts/:id/upload-image', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = await (request as any).file();

        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }

        try {
            const buffer = await data.toBuffer();
            const ext = data.filename.split('.').pop() || 'jpg';
            const filename = `post-${id}-${Date.now()}.${ext}`;
            const destinationPath = `uploads/${filename}`;

            console.log(`[Upload] Uploading ${filename} to Supabase Storage...`);
            const imageUrl = await storageService.uploadFileFromBuffer(buffer, data.mimetype, destinationPath);
            console.log(`[Upload] Upload success: ${imageUrl}`);

            await prisma.post.update({
                where: { id: parseInt(id) },
                data: {
                    image_url: imageUrl,
                    image_prompt: 'Uploaded by user'
                }
            });

            return { success: true, imageUrl };
        } catch (error: any) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Upload failed', details: error.message || error });
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
        const data = (request.body as any) || {};

        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: {
                ...data, // Allow updating publish_at, text, channel_id etc during approval
                status: 'scheduled'
            }
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
            const result = await publisherService.publishPostNow(parseInt(id));
            return {
                success: true,
                publishMethod: result.publishMethod,
                warning: result.warning || null
            };
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

        // Immediately update status and enqueue background generation via BullMQ
        await prisma.post.update({
            where: { id: post.id },
            data: { status: 'generating' }
        });

        const { postsQueue } = require('../queue');
        await postsQueue.add('generate-post', {
            projectId,
            theme: post.week!.theme,
            topic: post.topic,
            postId: post.id,
            promptOverride,
            withImage,
            isBatch: false
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 }
        });

        return reply.code(202).send({ success: true, message: 'Generation queued in background' });
    });

    fastify.post('/api/posts/:id/validate-dictionary', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { text } = request.body as { text?: string };

        const post = await prisma.post.findFirst({
            where: {
                id: parseInt(id),
                project_id: projectId
            }
        });

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const dictionarySetting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });

        const report = contentDictionaryService.validateText(
            text || post.final_text || post.generated_text || '',
            dictionarySetting?.value || null
        );

        return report;
    });

    fastify.get('/api/publication-tasks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { status, manualOnly } = request.query as { status?: string; manualOnly?: string };

        const items = await prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                assets: { not: undefined },
                ...(status ? { status } : {})
            },
            include: { channel: true },
            orderBy: { schedule_at: 'asc' }
        });

        const filtered = manualOnly === 'true'
            ? items.filter((item) => (item.quality_report as any)?.execution_mode === 'manual')
            : items;

        return filtered;
    });

    fastify.get('/api/publication-tasks/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        return item;
    });

    fastify.post('/api/publication-tasks/:id/prepare-handoff', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const plan = await loadPublicationPlanContext(projectId);
        if (!plan) {
            return reply.code(400).send({ error: 'Project has no imported publication plan context' });
        }

        const action = (item.assets as any)?.action;
        plan.actions = action ? [action] : [];
        const bundle = publicationPlanService.buildHandoffBundle(plan as any, item);

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: bundle.mode === 'manual' ? 'awaiting_manual_publication' : 'ready_for_execution',
                quality_report: {
                    ...((item.quality_report as any) || {}),
                    handoff_bundle: bundle,
                    prepared_at: new Date().toISOString()
                } as any
            }
        });

        return {
            item: updated,
            bundle
        };
    });

    fastify.post('/api/publication-tasks/:id/confirm-publication', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { publishedLink, note } = request.body as { publishedLink?: string; note?: string };

        if (!publishedLink) {
            return reply.code(400).send({ error: 'publishedLink is required' });
        }

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const monitoring = (item.metrics as any)?.monitoring || {};
        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: 'published',
                published_link: publishedLink,
                metrics: {
                    ...((item.metrics as any) || {}),
                    manual_confirmation_at: new Date().toISOString(),
                    monitoring: {
                        ...monitoring,
                        awaiting_analytics: true,
                        awaiting_comment_alerts: monitoring.needs_comment_monitoring === true
                    }
                } as any,
                quality_report: {
                    ...((item.quality_report as any) || {}),
                    manual_publication_note: note || null
                } as any
            }
        });

        return updated;
    });

    fastify.post('/api/publication-tasks/:id/record-metrics', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { metrics } = request.body as { metrics?: Record<string, any> };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...((item.metrics as any) || {}),
                    collected_metrics: metrics || {},
                    metrics_updated_at: new Date().toISOString()
                } as any
            }
        });

        return updated;
    });

    fastify.post('/api/publication-tasks/:id/external-comment-alert', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { text, commentUrl, author } = request.body as { text?: string; commentUrl?: string; author?: string };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const composed = [
            author ? `Author: ${author}` : null,
            text ? `Comment: ${text}` : null,
            commentUrl ? `URL: ${commentUrl}` : null
        ].filter(Boolean).join('\n');

        const comment = await commentService.createComment(projectId, 'content_item', item.id, composed || 'External comment alert received', 'assistant');

        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...((item.metrics as any) || {}),
                    last_comment_alert_at: new Date().toISOString()
                } as any
            }
        });

        return comment;
    });

    // Settings
    fastify.get('/api/settings/agents', async (request, reply) => {
        try {
            const projectId = (request as any).projectId;
            if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

            const roles = ['post_creator', 'post_critic', 'post_fixer', 'topic_creator', 'topic_critic', 'topic_fixer', 'visual_architect', 'structural_critic', 'precision_fixer', 'image_critic'];
            const agents = [];

            // Text Agents
            for (const role of roles) {
                try {
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
                } catch (e) {
                    console.error(`Failed to fetch config for role ${role}`, e);
                    // Push safe default instead of crashing
                    agents.push({
                        role,
                        prompt: '',
                        apiKey: '',
                        model: '',
                        provider: 'Error'
                    });
                }
            }

            // Image Agents (GPT-Image)
            try {
                const dallePrompt = await generatorService.getImagePromptTemplate(projectId, 'gpt-image');
                agents.push({
                    role: 'gpt_image_gen',
                    prompt: dallePrompt,
                    apiKey: '', // Managed via env mostly for now
                    model: 'dall-e-3',
                    provider: 'OpenAI (Env)'
                });
            } catch (e) {
                console.error('Failed to fetch DALL-E config', e);
            }

            // Image Agents (Nano)
            try {
                const nanoPrompt = await generatorService.getImagePromptTemplate(projectId, 'nano');
                agents.push({
                    role: 'nano_image_gen',
                    prompt: nanoPrompt,
                    apiKey: '',
                    model: 'imagen-3.0',
                    provider: 'Google (Env)'
                });
            } catch (e) {
                console.error('Failed to fetch Nano config', e);
            }

            return agents;
        } catch (e: any) {
            console.error('Error in GET /api/settings/agents:', e);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.put('/api/settings/agents/:role', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { role } = request.params as { role: string };
        const { prompt, apiKey, model } = request.body as { prompt: string; apiKey: string; model: string };

        // Handle Image Agents
        if (role === 'gpt_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'gpt-image');
            return { success: true };
        }
        if (role === 'nano_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'nano');
            return { success: true };
        }

        // Handle Text Agents
        const roleMap: any = {
            'post_creator': {
                prompt: multiAgentService.KEY_POST_CREATOR_PROMPT,
                key: multiAgentService.KEY_POST_CREATOR_KEY,
                model: multiAgentService.KEY_POST_CREATOR_MODEL
            },
            'post_critic': {
                prompt: multiAgentService.KEY_POST_CRITIC_PROMPT,
                key: multiAgentService.KEY_POST_CRITIC_KEY,
                model: multiAgentService.KEY_POST_CRITIC_MODEL
            },
            'post_fixer': {
                prompt: multiAgentService.KEY_POST_FIXER_PROMPT,
                key: multiAgentService.KEY_POST_FIXER_KEY,
                model: multiAgentService.KEY_POST_FIXER_MODEL
            },
            'topic_creator': {
                prompt: multiAgentService.KEY_TOPIC_CREATOR_PROMPT,
                key: multiAgentService.KEY_TOPIC_CREATOR_KEY,
                model: multiAgentService.KEY_TOPIC_CREATOR_MODEL
            },
            'topic_critic': {
                prompt: multiAgentService.KEY_TOPIC_CRITIC_PROMPT,
                key: multiAgentService.KEY_TOPIC_CRITIC_KEY,
                model: multiAgentService.KEY_TOPIC_CRITIC_MODEL
            },
            'topic_fixer': {
                prompt: multiAgentService.KEY_TOPIC_FIXER_PROMPT,
                key: multiAgentService.KEY_TOPIC_FIXER_KEY,
                model: multiAgentService.KEY_TOPIC_FIXER_MODEL
            },
            'visual_architect': {
                prompt: multiAgentService.KEY_VISUAL_ARCHITECT_PROMPT,
                key: multiAgentService.KEY_VISUAL_ARCHITECT_KEY,
                model: multiAgentService.KEY_VISUAL_ARCHITECT_MODEL
            },
            'structural_critic': {
                prompt: multiAgentService.KEY_STRUCTURAL_CRITIC_PROMPT,
                key: multiAgentService.KEY_STRUCTURAL_CRITIC_KEY,
                model: multiAgentService.KEY_STRUCTURAL_CRITIC_MODEL
            },
            'precision_fixer': {
                prompt: multiAgentService.KEY_PRECISION_FIXER_PROMPT,
                key: multiAgentService.KEY_PRECISION_FIXER_KEY,
                model: multiAgentService.KEY_PRECISION_FIXER_MODEL
            },
            'image_critic': {
                prompt: multiAgentService.KEY_IMAGE_CRITIC_PROMPT,
                key: multiAgentService.KEY_IMAGE_CRITIC_KEY,
                model: multiAgentService.KEY_IMAGE_CRITIC_MODEL
            }
        };

        const keys = roleMap[role];
        if (!keys) {
            return reply.code(400).send({ error: 'Invalid role' });
        }

        try {
            // Helper to safe update
            const saveSetting = async (key: string, value: string) => {
                const existing = await prisma.projectSettings.findUnique({
                    where: { project_id_key: { project_id: projectId, key } }
                });
                if (existing) {
                    await prisma.projectSettings.update({
                        where: { id: existing.id },
                        data: { value }
                    });
                } else {
                    await prisma.projectSettings.create({
                        data: { project_id: projectId, key, value }
                    });
                }
            };

            await saveSetting(keys.prompt, prompt);
            await saveSetting(keys.key, apiKey || '');
            await saveSetting(keys.model, model);

            return { success: true };
        } catch (e: any) {
            console.error(`Failed to save settings for ${role}`, e);
            return reply.code(500).send({ error: 'Failed to save settings', details: e.message });
        }
    });

    fastify.get('/api/settings/runs', async (request, reply) => {
        const runs = await prisma.agentRun.findMany({
            orderBy: { created_at: 'desc' },
            take: 50
        });

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

    fastify.get('/api/settings/content-dictionary', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });

        const yamlValue = setting?.value || contentDictionaryService.getDefaultYaml();
        const parsed = contentDictionaryService.parseYaml(yamlValue);

        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });

    fastify.put('/api/settings/content-dictionary', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { yaml: yamlText } = request.body as { yaml?: string };
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }

        try {
            const normalizedYaml = contentDictionaryService.normalizeToYaml(yamlText);
            const parsed = contentDictionaryService.parseYaml(normalizedYaml);

            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_dictionary_yaml',
                    value: normalizedYaml
                }
            });

            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Invalid dictionary YAML' });
        }
    });

    fastify.get('/api/settings/skill-connections', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } }
        });

        if (!setting?.value) {
            return [];
        }

        try {
            const parsed = JSON.parse(setting.value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to parse llm_skill_connections', error);
            return [];
        }
    });

    fastify.put('/api/settings/skill-connections', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { connections } = request.body as { connections?: any[] };
        if (!Array.isArray(connections)) {
            return reply.code(400).send({ error: 'connections must be an array' });
        }

        const normalized = connections.map((connection, index) => {
            if (!connection?.name || !connection?.provider || !connection?.model) {
                throw new Error(`connections[${index}] must include name, provider and model`);
            }

            return {
                id: String(connection.id || `skill-connection-${index + 1}`),
                name: String(connection.name).trim(),
                provider: String(connection.provider).trim(),
                model: String(connection.model).trim(),
                providerKeyId: typeof connection.providerKeyId === 'number' ? connection.providerKeyId : null,
                endpointType: String(connection.endpointType || 'native').trim(),
                skillMode: String(connection.skillMode || 'native_skills').trim(),
                enabledSkills: Array.isArray(connection.enabledSkills)
                    ? connection.enabledSkills.map((skill: any) => String(skill).trim()).filter(Boolean)
                    : [],
                systemPrompt: String(connection.systemPrompt || ''),
                notes: String(connection.notes || ''),
                enabled: connection.enabled !== false,
                supportsSkills: connection.supportsSkills !== false
            };
        });

        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } },
            update: { value: JSON.stringify(normalized) },
            create: {
                project_id: projectId,
                key: 'llm_skill_connections',
                value: JSON.stringify(normalized)
            }
        });

        return normalized;
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

    // ==========================================
    // V2 Orchestrator Routes
    // ==========================================

    fastify.get('/api/v2/weeks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const weeks = await prisma.weekPackage.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { content_items: true } } }
        });
        return weeks;
    });

    fastify.get('/api/v2/weeks/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const week = await prisma.weekPackage.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: {
                content_items: {
                    orderBy: { schedule_at: 'asc' }
                }
            }
        });

        if (!week) return reply.code(404).send({ error: 'V2 WeekPackage not found' });
        return week;
    });

    fastify.post('/api/v2/plan-week', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { themeHint, startDate } = request.body as { themeHint: string; startDate?: string };

        // Determine next Monday if not provided
        let weekStart = new Date();
        if (startDate) {
            weekStart = new Date(startDate);
        } else {
            const dayOfWeek = weekStart.getDay();
            const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
            weekStart.setDate(weekStart.getDate() + daysUntilNextMonday);
        }
        weekStart.setUTCHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setUTCHours(23, 59, 59, 999);

        try {
            // 1. SMO
            const wp = await v2Orchestrator.planWeek(projectId, weekStart, weekEnd, themeHint || '');

            // 2. DA (Dynamic split from MTA/SMO)
            await v2Orchestrator.architectDistribution(wp.id);

            // 3. NCC
            const validation = await v2Orchestrator.validateContinuity(wp.id);
            if (!validation.valid) {
                console.warn(`[NCC] Validation failed for WP ${wp.id}: ${validation.critique}`);
                // Save risks back or handle
            }

            return { success: true, weekPackageId: wp.id, validation };
        } catch (e: any) {
            console.error('[API] Error in V2 plan-week:', e);
            reply.code(500).send({ error: 'Failed to complete V2 planning', details: e.message });
        }
    });

    fastify.post('/api/v2/approve-week/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };

        const wp = await prisma.weekPackage.findUnique({ where: { id: parseInt(id), project_id: projectId } });
        if (!wp) return reply.code(404).send({ error: 'WeekPackage not found' });

        const updated = await prisma.weekPackage.update({
            where: { id: wp.id },
            data: { approval_status: 'approved' }
        });

        return { success: true, status: updated.approval_status };
    });

    fastify.post('/api/v2/architect-week/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };

        try {
            const items = await v2Orchestrator.architectDistribution(parseInt(id));
            return { success: true, count: items.length };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'Failed to architect week' });
        }
    });

    fastify.post('/api/v2/plan-quarter', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { goalHint, startDate, plannedChannels } = request.body as { goalHint?: string; startDate?: string; plannedChannels?: any };
        const dStart = startDate ? new Date(startDate) : new Date();

        try {
            const result = await v2Orchestrator.planQuarter(projectId, dStart, goalHint, plannedChannels);

            // For MVP, immediately kick off Monthly Tactical Agents (MTA) for all 3 generated months
            for (const month of result.monthArcs) {
                await v2Orchestrator.planMonth(month.id);
            }

            return { success: true, quarterId: result.quarterPlan.id };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'Failed to plan quarter' });
        }
    });

    fastify.get('/api/v2/quarters', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            include: {
                month_arcs: {
                    include: {
                        week_packages: true
                    }
                }
            }
        });
        return quarters;
    });

    fastify.post('/api/v2/factory-sweep', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        try {
            // Trigger the generator service script Logic asynchronously or await it here.
            // For MVP API, we do it inline and block or trigger child process.
            // Let's do a lightweight inline sweep for just 2 items to prevent timeout
            const itemsToProcess = await prisma.contentItem.findMany({
                where: {
                    project_id: projectId,
                    status: 'planned',
                    week_package: { approval_status: 'approved' }
                },
                take: 2 // Max 2 per api ping to avoid 504 timeouts
            });

            const results = [];
            for (const item of itemsToProcess) {
                try {
                    await generatorService.generateContentItemText(item.id);
                    results.push({ id: item.id, status: 'drafted' });
                } catch (e: any) {
                    await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'failed' } });
                    results.push({ id: item.id, status: 'failed', error: e.message });
                }
            }
            return { processed: results.length, results };
        } catch (e: any) {
            reply.code(500).send({ error: 'Failed during factory sweep', details: e.message });
        }
    });

    // ─── Strategy Assistant Chat ─────────────────────────────────────────────

    const DEFAULT_STRATEGY_PROMPT = `Ты — Стратегический Ассистент по контенту.
Твоя задача: помогать автору выстроить эффективную контентную стратегию для его каналов.
Ты учитываешь:
- Разные платформы (Telegram, VK, YouTube и т.д.) и их специфику аудитории
- Принципы стабильного контентного потока (контент-план, ритм публикаций)
- Воронку прогрева: Awareness → Authority → Conversion
- Текущий квартальный план и месячные арки
Ты задаёшь уточняющие вопросы, предлагаешь конкретные решения и форматы постов.
Отвечай на русском языке. Будь кратким, конкретным и полезным.`;

    /**
     * GET the current system prompt for the strategy assistant.
     */
    fastify.get('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = (request as any).projectId;
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        return {
            systemPrompt: setting?.value || DEFAULT_STRATEGY_PROMPT
        };
    });

    /**
     * PUT updated system prompt for the strategy assistant.
     */
    fastify.put('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = (request as any).projectId;
        const { systemPrompt } = request.body as { systemPrompt: string };
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } },
            update: { value: systemPrompt },
            create: { project_id: projectId, key: 'strategy_assistant_prompt', value: systemPrompt }
        });
        return { success: true };
    });

    /**
     * POST a message to the strategy assistant. Accepts conversation history.
     * Body: { message: string; history: { role: 'user'|'assistant'; content: string }[] }
     */
    fastify.post('/api/v2/strategy-chat', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { message, history = [] } = request.body as {
            message: string;
            history: { role: 'user' | 'assistant'; content: string }[];
        };

        if (!message?.trim()) return reply.code(400).send({ error: 'Message is required' });

        // Load custom system prompt (or use default)
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        const systemPrompt = setting?.value || DEFAULT_STRATEGY_PROMPT;

        // Load current quarters for context
        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            take: 1,
            include: { month_arcs: true }
        });
        const contextStr = quarters.length > 0
            ? `\n\nТекущий квартальный план:\nЦель: ${quarters[0].strategic_goal}\nПилар: ${quarters[0].primary_pillar}\nМесяцы: ${quarters[0].month_arcs.map(m => m.arc_theme).join(', ')}`
            : '';

        const openai = new (require('openai').default)({ apiKey: process.env.OPENAI_API_KEY });

        const messages = [
            { role: 'system' as const, content: systemPrompt + contextStr },
            ...history.slice(-10), // keep last 10 turns for context
            { role: 'user' as const, content: message }
        ];

        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages,
                max_tokens: 1000
            });
            const reply_text = completion.choices[0]?.message.content || '';
            return { reply: reply_text };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'AI request failed' });
        }
    });
}
