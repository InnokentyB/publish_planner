"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = apiRoutes;
const planner_service_1 = __importDefault(require("../services/planner.service"));
const generator_service_1 = __importDefault(require("../services/generator.service"));
const multi_agent_service_1 = __importDefault(require("../services/multi_agent.service"));
const publisher_service_1 = __importDefault(require("../services/publisher.service"));
const model_service_1 = __importDefault(require("../services/model.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const auth_service_1 = __importDefault(require("../services/auth.service"));
const comment_service_1 = __importDefault(require("../services/comment.service"));
const storage_service_1 = __importDefault(require("../services/storage.service"));
async function apiRoutes(fastify) {
    // Auth and Project context middleware
    fastify.addHook('preHandler', async (request, reply) => {
        // Skip auth for static files if needed, but here we cover /api/
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Authentication required' });
            return;
        }
        try {
            const user = auth_service_1.default.verifyToken(token);
            request.user = user;
            const projectId = request.headers['x-project-id'];
            if (projectId) {
                const pid = parseInt(projectId);
                const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, pid);
                if (!hasAccess) {
                    reply.code(403).send({ error: 'No access to this project' });
                    return;
                }
                request.projectId = pid;
            }
        }
        catch (e) {
            reply.code(401).send({ error: 'Invalid or expired token' });
        }
    });
    // Weeks
    fastify.get('/api/weeks', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const weeks = await prisma.week.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { posts: true } } }
        });
        return weeks;
    });
    fastify.post('/api/weeks', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { theme, startDate } = request.body;
        let start, end;
        if (startDate) {
            const date = new Date(startDate);
            const range = await planner_service_1.default.getWeekRangeForDate(date);
            start = range.start;
            end = range.end;
        }
        else {
            const range = await planner_service_1.default.getNextWeekRange();
            start = range.start;
            end = range.end;
        }
        try {
            const week = await planner_service_1.default.createWeek(projectId, theme, start, end);
            // Default: All 7 days (14 slots)
            await planner_service_1.default.generateSlots(week.id, projectId, start, 14, 0);
            return week;
        }
        catch (e) {
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
            const { id } = request.params;
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
            const serializedPosts = week.posts.map((p) => ({
                ...p,
                approval_message_id: p.approval_message_id ? p.approval_message_id.toString() : null
            }));
            return { ...week, posts: serializedPosts, topics };
        }
        catch (e) {
            console.error('Error in GET /api/weeks/:id:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /weeks/${request.params.id}: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    fastify.put('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params;
        const data = request.body;
        const week = await prisma.week.update({
            where: { id: parseInt(id) },
            data
        });
        return week;
    });
    fastify.delete('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params;
        await prisma.week.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });
    // Week actions
    fastify.post('/api/weeks/:id/generate-topics', async (request, reply) => {
        try {
            const projectId = request.projectId;
            console.log('[API] Generate Topics Request:', {
                projectId,
                params: request.params,
                headers_x_project_id: request.headers['x-project-id']
            });
            if (!projectId) {
                console.error('[API] Missing Project ID');
                return reply.code(400).send({ error: 'Project ID required' });
            }
            const { id } = request.params;
            const { promptPresetId, overwrite } = request.body;
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
            let promptOverride;
            if (promptPresetId) {
                const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
                if (preset)
                    promptOverride = preset.prompt_text;
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
            }
            else {
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
            await planner_service_1.default.generateSlots(week.id, projectId, week.week_start, countToGenerate, existingCount);
            const result = await generator_service_1.default.generateTopics(projectId, week.theme, week.id, promptOverride, countToGenerate, existingTopics);
            // Save topics starting at the correct offset
            await planner_service_1.default.saveTopics(week.id, result.topics, existingCount);
            return { success: true, topics: result.topics };
        }
        catch (error) {
            console.error('[API Error] Generate Topics Failed:', error);
            const fs = require('fs');
            const logEntry = `[${new Date().toISOString()}] Error in /generate-topics: ${error.message}\nStack: ${error.stack}\n\n`;
            fs.appendFileSync('server_error.log', logEntry);
            return reply.code(500).send({ error: 'Internal Server Error', details: error.message });
        }
    });
    fastify.post('/api/weeks/:id/approve-topics', async (request, reply) => {
        const { id } = request.params;
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
        await planner_service_1.default.updateWeekStatus(weekId, 'topics_approved');
        return { success: true };
    });
    fastify.post('/api/weeks/:id/generate-posts', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: { posts: true }
        });
        if (!week) {
            reply.code(404).send({ error: 'Week not found' });
            return;
        }
        await planner_service_1.default.updateWeekStatus(week.id, 'generating');
        // Generate posts asynchronously
        (async () => {
            for (const post of week.posts) {
                if (!post.topic)
                    continue;
                try {
                    const genResult = await generator_service_1.default.generatePostText(projectId, week.theme, post.topic, post.id);
                    let fullText = genResult.text;
                    const tagsToAdd = [];
                    // Add Category if present and not in text
                    if (genResult.category || post.category) {
                        const cat = (genResult.category || post.category || '').replace(/^#/, '').trim();
                        if (cat && !fullText.includes(`#${cat}`)) {
                            tagsToAdd.push(cat);
                        }
                    }
                    // Add Tags if present
                    if (genResult.tags && Array.isArray(genResult.tags)) {
                        genResult.tags.forEach(t => {
                            const cleanTag = t.replace(/^#/, '').trim();
                            if (cleanTag && !tagsToAdd.includes(cleanTag) && !fullText.includes(`#${cleanTag}`)) {
                                tagsToAdd.push(cleanTag);
                            }
                        });
                    }
                    if (tagsToAdd.length > 0) {
                        const tagsString = tagsToAdd.map(t => `#${t}`).join(' ');
                        fullText += `\n\n${tagsString}`;
                    }
                    await planner_service_1.default.updatePost(post.id, {
                        generated_text: fullText,
                        final_text: fullText,
                        category: genResult.category || post.category,
                        tags: genResult.tags || [],
                        status: 'generated'
                    });
                }
                catch (err) {
                    console.error(`Error generating post ${post.id}:`, err);
                }
            }
            await planner_service_1.default.updateWeekStatus(week.id, 'generated');
        })();
        return { success: true, message: 'Generation started' };
    });
    fastify.post('/api/weeks/:id/generate-sequential', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id) }
        });
        if (!week)
            return reply.code(404).send({ error: 'Week not found' });
        // Trigger background generation
        (async () => {
            const writer = require('../services/sequential_writer.service').default;
            try {
                await writer.generateWeekPosts(projectId, week.id);
            }
            catch (e) {
                console.error('Sequential generation failed', e);
            }
        })();
        return { success: true, message: 'Sequential generation started' };
    });
    fastify.post('/api/posts/:id/generate-image', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const { provider } = request.body;
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) }
        });
        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }
        try {
            console.log(`[Generate Image] Request for Post ${id}, Provider: ${provider || 'dalle'}`);
            const textToUse = post.final_text || post.generated_text || post.topic || '';
            const fs = require('fs');
            // 1. Generate Prompt (Multi-Agent Chain)
            console.log('[Generate Image] Generating prompt via Multi-Agent Chain...');
            const imagePrompt = await multi_agent_service_1.default.runImagePromptingChain(post.project_id, textToUse, post.topic || 'Tech Post');
            console.log(`[Generate Image] Generated prompt: ${imagePrompt.substring(0, 100)}...`);
            // 2. Generate Image
            let imageUrl = '';
            // Ensure prompt is valid for DALL-E (not empty or just whitespace)
            let safePrompt = imagePrompt;
            if (!safePrompt || safePrompt.trim().length === 0) {
                console.warn('[Generate Image] Fallback triggered: imagePrompt was empty or whitespace');
                safePrompt = `A professional vector illustration for a tech blog post about: ${post.topic || 'Technology'}. Minimalist style.`;
            }
            if (provider === 'nano') {
                fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Calling Nano...\n`);
                imageUrl = await generator_service_1.default.generateImageNanoBanana(safePrompt);
            }
            else if (provider === 'full') {
                fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Calling Full Pipeline...\n`);
                // 1. DALL-E
                const dalleUrl = await generator_service_1.default.generateImage(safePrompt);
                // 2. Critic
                const criticResult = await multi_agent_service_1.default.runImageCritic(post.project_id, textToUse, dalleUrl);
                if (!criticResult)
                    throw new Error("Critic failed to generate feedback.");
                safePrompt = criticResult.new_prompt; // Update prompt to the new one
                // 3. Nano Banana with reference
                imageUrl = await generator_service_1.default.generateImageNanoBanana(safePrompt, dalleUrl);
            }
            else {
                fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Calling DALL-E...\n`);
                imageUrl = await generator_service_1.default.generateImage(safePrompt);
            }
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] Image Gen Success. URL: ${imageUrl}\n`);
            // 3. Save to DB
            await planner_service_1.default.updatePost(post.id, {
                image_url: imageUrl,
                image_prompt: safePrompt
            });
            return { success: true, imageUrl, imagePrompt: safePrompt };
        }
        catch (error) {
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Image Gen Error (Post ${id}): ${error.message}\n${error.stack}\n\n`);
            request.log.error(error);
            return reply.code(500).send({ error: `Upload failed: ${error.message}` });
        }
    });
    fastify.post('/api/posts/:id/upload-image', async (request, reply) => {
        const { id } = request.params;
        const data = await request.file();
        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }
        try {
            const buffer = await data.toBuffer();
            const ext = data.filename.split('.').pop() || 'jpg';
            const filename = `post-${id}-${Date.now()}.${ext}`;
            const destinationPath = `uploads/${filename}`;
            console.log(`[Upload] Uploading ${filename} to Supabase Storage...`);
            const imageUrl = await storage_service_1.default.uploadFileFromBuffer(buffer, data.mimetype, destinationPath);
            console.log(`[Upload] Upload success: ${imageUrl}`);
            await prisma.post.update({
                where: { id: parseInt(id) },
                data: {
                    image_url: imageUrl,
                    image_prompt: 'Uploaded by user'
                }
            });
            return { success: true, imageUrl };
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Upload failed', details: error.message || error });
        }
    });
    // Posts
    fastify.get('/api/posts/:id', async (request, reply) => {
        const { id } = request.params;
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
        const { id } = request.params;
        const data = request.body;
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data
        });
        return post;
    });
    fastify.post('/api/posts/:id/approve', async (request, reply) => {
        const { id } = request.params;
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: { status: 'scheduled' }
        });
        return post;
    });
    fastify.post('/api/posts/:id/approve-topic', async (request, reply) => {
        const { id } = request.params;
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: { status: 'topics_approved' }
        });
        return post;
    });
    fastify.post('/api/posts/:id/publish-now', async (request, reply) => {
        const { id } = request.params;
        try {
            await publisher_service_1.default.publishPostNow(parseInt(id));
            return { success: true };
        }
        catch (e) {
            console.error('Publish now failed', e);
            reply.code(500).send({ error: e.message });
        }
    });
    fastify.post('/api/posts/:id/generate', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
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
        const { promptPresetId, withImage } = request.body;
        let promptOverride;
        if (promptPresetId) {
            const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
            if (preset)
                promptOverride = preset.prompt_text;
        }
        // Immediately update status and return 202 to prevent 503 timeouts
        await prisma.post.update({
            where: { id: post.id },
            data: { status: 'generating' }
        });
        // Background generation
        (async () => {
            try {
                const result = await generator_service_1.default.generatePostText(projectId, post.week.theme, post.topic, post.id, promptOverride, withImage);
                let fullText = result.text;
                if (result.tags && result.tags.length > 0) {
                    fullText += '\n\n' + result.tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
                }
                else if (post.category) { // Fallback to existing category if new tags fail
                    fullText += `\n\n#${post.category.replace(/\s+/g, '')}`;
                }
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        generated_text: fullText,
                        final_text: fullText,
                        status: 'generated',
                        category: result.category || undefined,
                        tags: result.tags || undefined
                    }
                });
            }
            catch (err) {
                console.error(`Error generating post ${post.id}:`, err);
                const fs = require('fs');
                fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Post Gen Error (Post ${post.id}): ${err.message}\n${err.stack}\n\n`);
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'planned' }
                });
            }
        })();
        return reply.code(202).send({ success: true, message: 'Generation started in background' });
    });
    // Settings
    fastify.get('/api/settings/agents', async (request, reply) => {
        try {
            const projectId = request.projectId;
            if (!projectId)
                return reply.code(400).send({ error: 'Project ID required' });
            const roles = ['post_creator', 'post_critic', 'post_fixer', 'topic_creator', 'topic_critic', 'topic_fixer', 'visual_architect', 'structural_critic', 'precision_fixer'];
            const agents = [];
            // Text Agents
            for (const role of roles) {
                try {
                    const config = await multi_agent_service_1.default.getAgentConfig(projectId, role);
                    let provider = 'Not Configured';
                    if (config.apiKey) {
                        if (config.apiKey.startsWith('sk-ant'))
                            provider = 'Anthropic';
                        else if (config.apiKey.startsWith('AIza'))
                            provider = 'Gemini';
                        else if (config.apiKey.startsWith('sk-'))
                            provider = 'OpenAI';
                        else
                            provider = 'Unknown';
                    }
                    agents.push({
                        role,
                        prompt: config.prompt,
                        apiKey: config.apiKey,
                        model: config.model,
                        provider
                    });
                }
                catch (e) {
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
            // Image Agents (DALL-E)
            try {
                const dallePrompt = await generator_service_1.default.getImagePromptTemplate(projectId, 'dalle');
                agents.push({
                    role: 'dalle_image_gen',
                    prompt: dallePrompt,
                    apiKey: '', // Managed via env mostly for now
                    model: 'dall-e-3',
                    provider: 'OpenAI (Env)'
                });
            }
            catch (e) {
                console.error('Failed to fetch DALL-E config', e);
            }
            // Image Agents (Nano)
            try {
                const nanoPrompt = await generator_service_1.default.getImagePromptTemplate(projectId, 'nano');
                agents.push({
                    role: 'nano_image_gen',
                    prompt: nanoPrompt,
                    apiKey: '',
                    model: 'imagen-3.0',
                    provider: 'Google (Env)'
                });
            }
            catch (e) {
                console.error('Failed to fetch Nano config', e);
            }
            return agents;
        }
        catch (e) {
            console.error('Error in GET /api/settings/agents:', e);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    fastify.put('/api/settings/agents/:role', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { role } = request.params;
        const { prompt, apiKey, model } = request.body;
        // Handle Image Agents
        if (role === 'dalle_image_gen') {
            await generator_service_1.default.updateImagePromptTemplate(projectId, prompt, 'dalle');
            return { success: true };
        }
        if (role === 'nano_image_gen') {
            await generator_service_1.default.updateImagePromptTemplate(projectId, prompt, 'nano');
            return { success: true };
        }
        // Handle Text Agents
        const roleMap = {
            'post_creator': {
                prompt: multi_agent_service_1.default.KEY_POST_CREATOR_PROMPT,
                key: multi_agent_service_1.default.KEY_POST_CREATOR_KEY,
                model: multi_agent_service_1.default.KEY_POST_CREATOR_MODEL
            },
            'post_critic': {
                prompt: multi_agent_service_1.default.KEY_POST_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_POST_CRITIC_MODEL
            },
            'post_fixer': {
                prompt: multi_agent_service_1.default.KEY_POST_FIXER_PROMPT,
                key: multi_agent_service_1.default.KEY_POST_FIXER_KEY,
                model: multi_agent_service_1.default.KEY_POST_FIXER_MODEL
            },
            'topic_creator': {
                prompt: multi_agent_service_1.default.KEY_TOPIC_CREATOR_PROMPT,
                key: multi_agent_service_1.default.KEY_TOPIC_CREATOR_KEY,
                model: multi_agent_service_1.default.KEY_TOPIC_CREATOR_MODEL
            },
            'topic_critic': {
                prompt: multi_agent_service_1.default.KEY_TOPIC_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_TOPIC_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_TOPIC_CRITIC_MODEL
            },
            'topic_fixer': {
                prompt: multi_agent_service_1.default.KEY_TOPIC_FIXER_PROMPT,
                key: multi_agent_service_1.default.KEY_TOPIC_FIXER_KEY,
                model: multi_agent_service_1.default.KEY_TOPIC_FIXER_MODEL
            },
            'visual_architect': {
                prompt: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_PROMPT,
                key: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_KEY,
                model: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_MODEL
            },
            'structural_critic': {
                prompt: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_PROMPT,
                key: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_KEY,
                model: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_MODEL
            },
            'precision_fixer': {
                prompt: multi_agent_service_1.default.KEY_PRECISION_FIXER_PROMPT,
                key: multi_agent_service_1.default.KEY_PRECISION_FIXER_KEY,
                model: multi_agent_service_1.default.KEY_PRECISION_FIXER_MODEL
            }
        };
        const keys = roleMap[role];
        if (!keys) {
            return reply.code(400).send({ error: 'Invalid role' });
        }
        try {
            // Helper to safe update
            const saveSetting = async (key, value) => {
                const existing = await prisma.projectSettings.findUnique({
                    where: { project_id_key: { project_id: projectId, key } }
                });
                if (existing) {
                    await prisma.projectSettings.update({
                        where: { id: existing.id },
                        data: { value }
                    });
                }
                else {
                    await prisma.projectSettings.create({
                        data: { project_id: projectId, key, value }
                    });
                }
            };
            await saveSetting(keys.prompt, prompt);
            await saveSetting(keys.key, apiKey || '');
            await saveSetting(keys.model, model);
            return { success: true };
        }
        catch (e) {
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
            const projectId = request.projectId;
            if (!projectId)
                return reply.code(400).send({ error: 'Project ID required' });
            return await prisma.promptPreset.findMany({
                where: { project_id: projectId },
                orderBy: { created_at: 'desc' }
            });
        }
        catch (e) {
            console.error('Error in GET /api/settings/presets:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /presets: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    fastify.post('/api/settings/presets', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { name, role, prompt_text } = request.body;
        return await prisma.promptPreset.create({
            data: { project_id: projectId, name, role, prompt_text }
        });
    });
    fastify.put('/api/settings/presets/:id', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        const data = request.body;
        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0)
            return reply.code(404).send({ error: 'Not found' });
        return await prisma.promptPreset.update({
            where: { id: parseInt(id) },
            data
        });
    });
    fastify.delete('/api/settings/presets/:id', async (request, reply) => {
        const projectId = request.projectId;
        const { id } = request.params;
        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0)
            return reply.code(404).send({ error: 'Not found' });
        await prisma.promptPreset.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });
    // Comments
    fastify.get('/api/comments', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { entityType, entityId } = request.query;
        if (!entityType || !entityId)
            return reply.code(400).send({ error: 'Missing params' });
        return await comment_service_1.default.getComments(projectId, entityType, parseInt(entityId));
    });
    fastify.post('/api/comments', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { entityType, entityId, text } = request.body;
        return await comment_service_1.default.createComment(projectId, entityType, parseInt(entityId), text, 'user');
    });
    // Keys Management
    fastify.get('/api/settings/keys', async (request, reply) => {
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
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
        const projectId = request.projectId;
        if (!projectId)
            return reply.code(400).send({ error: 'Project ID required' });
        const { name, key } = request.body;
        let provider = 'Other';
        if (key.startsWith('sk-ant'))
            provider = 'Anthropic';
        else if (key.startsWith('AIza'))
            provider = 'Gemini';
        else if (key.startsWith('sk-'))
            provider = 'OpenAI';
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
        const projectId = request.projectId;
        const { id } = request.params;
        // Ensure belongs to project
        const count = await prisma.providerKey.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0)
            return reply.code(404).send({ error: 'Not found' });
        await prisma.providerKey.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });
    // Model Fetching
    fastify.get('/api/settings/models', async (request, reply) => {
        const projectId = request.projectId;
        const { provider, keyId, key } = request.query;
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
        if (!apiKey)
            return reply.code(400).send({ error: 'API Key required' });
        // Auto-detect provider if missing
        if (!detectedProvider || detectedProvider === 'Unknown') {
            if (apiKey.startsWith('sk-ant'))
                detectedProvider = 'Anthropic';
            else if (apiKey.startsWith('AIza'))
                detectedProvider = 'Gemini';
            else if (apiKey.startsWith('sk-'))
                detectedProvider = 'OpenAI';
        }
        const models = await model_service_1.default.fetchModels(detectedProvider, apiKey);
        return { models };
    });
}
