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
const js_yaml_1 = __importDefault(require("js-yaml"));
const multi_agent_service_1 = __importDefault(require("../services/multi_agent.service"));
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const agentSettingKeyMap = {
    post_creator: {
        prompt: multi_agent_service_1.default.KEY_POST_CREATOR_PROMPT,
        key: multi_agent_service_1.default.KEY_POST_CREATOR_KEY,
        model: multi_agent_service_1.default.KEY_POST_CREATOR_MODEL
    },
    post_critic: {
        prompt: multi_agent_service_1.default.KEY_POST_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_POST_CRITIC_MODEL
    },
    post_fixer: {
        prompt: multi_agent_service_1.default.KEY_POST_FIXER_PROMPT,
        key: multi_agent_service_1.default.KEY_POST_FIXER_KEY,
        model: multi_agent_service_1.default.KEY_POST_FIXER_MODEL
    },
    topic_creator: {
        prompt: multi_agent_service_1.default.KEY_TOPIC_CREATOR_PROMPT,
        key: multi_agent_service_1.default.KEY_TOPIC_CREATOR_KEY,
        model: multi_agent_service_1.default.KEY_TOPIC_CREATOR_MODEL
    },
    topic_critic: {
        prompt: multi_agent_service_1.default.KEY_TOPIC_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_TOPIC_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_TOPIC_CRITIC_MODEL
    },
    topic_fixer: {
        prompt: multi_agent_service_1.default.KEY_TOPIC_FIXER_PROMPT,
        key: multi_agent_service_1.default.KEY_TOPIC_FIXER_KEY,
        model: multi_agent_service_1.default.KEY_TOPIC_FIXER_MODEL
    },
    visual_architect: {
        prompt: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_PROMPT,
        key: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_KEY,
        model: multi_agent_service_1.default.KEY_VISUAL_ARCHITECT_MODEL
    },
    structural_critic: {
        prompt: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_STRUCTURAL_CRITIC_MODEL
    },
    precision_fixer: {
        prompt: multi_agent_service_1.default.KEY_PRECISION_FIXER_PROMPT,
        key: multi_agent_service_1.default.KEY_PRECISION_FIXER_KEY,
        model: multi_agent_service_1.default.KEY_PRECISION_FIXER_MODEL
    },
    image_critic: {
        prompt: multi_agent_service_1.default.KEY_IMAGE_CRITIC_PROMPT,
        key: multi_agent_service_1.default.KEY_IMAGE_CRITIC_KEY,
        model: multi_agent_service_1.default.KEY_IMAGE_CRITIC_MODEL
    }
};
function slugifyProjectName(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}
async function makeUniqueProjectSlug(baseSlug, fallbackName) {
    const source = baseSlug?.trim() || fallbackName || 'project';
    const normalized = slugifyProjectName(source) || `project-${Date.now()}`;
    let candidate = normalized;
    let suffix = 1;
    while (await prisma.project.findUnique({ where: { slug: candidate } })) {
        candidate = `${normalized}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}
function parseImportedProjectConfig(rawConfig) {
    const trimmed = rawConfig.trim();
    if (!trimmed) {
        throw new Error('Configuration is empty');
    }
    const parsed = js_yaml_1.default.load(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Configuration must be a YAML or JSON object');
    }
    return parsed;
}
async function buildImportedProjectData(rawConfig, userId) {
    const parsed = parseImportedProjectConfig(rawConfig);
    const projectBlock = parsed.project || {};
    const name = projectBlock.name?.trim();
    if (!name) {
        throw new Error('`project.name` is required');
    }
    const slug = await makeUniqueProjectSlug(projectBlock.slug, name);
    const description = projectBlock.description?.trim() || null;
    const settings = Object.entries(parsed.settings || {})
        .filter(([key, value]) => typeof key === 'string' && key.trim() && value !== undefined && value !== null)
        .map(([key, value]) => ({
        key: key.trim(),
        value: typeof value === 'string' ? value : JSON.stringify(value)
    }));
    const channels = (parsed.channels || []).map((channel, index) => {
        if (!channel?.type || !channel?.name) {
            throw new Error(`channels[${index}] must include both type and name`);
        }
        return {
            type: channel.type.trim(),
            name: channel.name.trim(),
            config: (channel.config || {})
        };
    });
    const agentSettings = Object.entries(parsed.agents || {}).flatMap(([role, config]) => {
        if (role === 'gpt_image_gen') {
            if (config?.prompt === undefined) {
                throw new Error('gpt_image_gen must include prompt');
            }
            return [{ key: 'image_generation_prompt', value: String(config.prompt) }];
        }
        if (role === 'nano_image_gen') {
            if (config?.prompt === undefined) {
                throw new Error('nano_image_gen must include prompt');
            }
            return [{ key: 'nano_banana_image_prompt', value: String(config.prompt) }];
        }
        const keys = agentSettingKeyMap[role];
        if (!keys) {
            throw new Error(`Unsupported agent role: ${role}`);
        }
        const entries = [];
        if (config?.prompt !== undefined)
            entries.push({ key: keys.prompt, value: String(config.prompt) });
        if (config?.apiKey !== undefined)
            entries.push({ key: keys.key, value: String(config.apiKey) });
        if (config?.model !== undefined)
            entries.push({ key: keys.model, value: String(config.model) });
        return entries;
    });
    const presets = (parsed.presets || []).map((preset, index) => {
        if (!preset?.name || !preset?.role || !preset?.prompt_text) {
            throw new Error(`presets[${index}] must include name, role and prompt_text`);
        }
        return {
            name: preset.name.trim(),
            role: preset.role.trim(),
            prompt_text: preset.prompt_text
        };
    });
    const uniqueSettings = Array.from(new Map([...settings, ...agentSettings].map((setting) => [setting.key, setting])).values());
    return {
        project: {
            name,
            slug,
            description,
            members: {
                create: {
                    user_id: userId,
                    role: 'owner'
                }
            }
        },
        settings: uniqueSettings,
        channels,
        presets
    };
}
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
        const finalSlug = await makeUniqueProjectSlug(slug, name);
        const project = await prisma.project.create({
            data: {
                name,
                slug: finalSlug,
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
    fastify.post('/api/projects/import', async (request, reply) => {
        const user = request.user;
        const { config } = request.body;
        if (!config || typeof config !== 'string') {
            return reply.code(400).send({ error: 'Configuration text is required' });
        }
        try {
            const imported = await buildImportedProjectData(config, user.id);
            const project = await prisma.$transaction(async (tx) => {
                const createdProject = await tx.project.create({
                    data: imported.project
                });
                if (imported.settings.length > 0) {
                    await tx.projectSettings.createMany({
                        data: imported.settings.map((setting) => ({
                            project_id: createdProject.id,
                            key: setting.key,
                            value: setting.value
                        }))
                    });
                }
                if (imported.channels.length > 0) {
                    await tx.socialChannel.createMany({
                        data: imported.channels.map((channel) => ({
                            project_id: createdProject.id,
                            type: channel.type,
                            name: channel.name,
                            config: channel.config
                        }))
                    });
                }
                if (imported.presets.length > 0) {
                    await tx.promptPreset.createMany({
                        data: imported.presets.map((preset) => ({
                            project_id: createdProject.id,
                            name: preset.name,
                            role: preset.role,
                            prompt_text: preset.prompt_text
                        }))
                    });
                }
                return createdProject;
            });
            return {
                ...project,
                imported: {
                    settings: imported.settings.length,
                    channels: imported.channels.length,
                    presets: imported.presets.length
                }
            };
        }
        catch (error) {
            return reply.code(400).send({ error: error.message || 'Failed to import project configuration' });
        }
    });
    // Update project settings
    fastify.post('/api/projects/:id/settings', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { key, value } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }
        const setting = await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            },
            update: { value },
            create: {
                project_id: projectId,
                key,
                value
            }
        });
        return setting;
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
                settings: true,
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
    fastify.put('/api/projects/:id', async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        const { name, description } = request.body;
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
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
        const user = request.user;
        const { id } = request.params;
        const { email, role } = request.body; // role: editor, viewer
        const projectId = parseInt(id);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can add members' });
            return;
        }
        // Find user by email
        const targetUser = await prisma.user.findUnique({ where: { email } });
        // If user not found, create invitation
        if (!targetUser) {
            // Check existing invitation
            const existingInvite = await prisma.projectInvitation.findFirst({
                where: { project_id: projectId, email }
            });
            if (existingInvite) {
                // Return existing token
                return {
                    status: 'invited',
                    message: 'Invitation already exists',
                    invite_link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${existingInvite.token}`
                };
            }
            // Create new invitation
            const token = require('crypto').randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry
            const invitation = await prisma.projectInvitation.create({
                data: {
                    project_id: projectId,
                    email,
                    role: role || 'viewer',
                    token,
                    expires_at: expiresAt,
                    created_by: user.id
                }
            });
            return {
                status: 'invited',
                message: 'Invitation created',
                invite_link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${token}`
            };
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
    // --- Invitation Routes ---
    // Get invitation details
    fastify.get('/api/invitations/:token', async (request, reply) => {
        const { token } = request.params;
        const invitation = await prisma.projectInvitation.findUnique({
            where: { token },
            include: {
                project: { select: { name: true, description: true } },
                creator: { select: { name: true, email: true } }
            }
        });
        if (!invitation) {
            return reply.code(404).send({ error: 'Invitation not found' });
        }
        if (new Date() > invitation.expires_at) {
            return reply.code(410).send({ error: 'Invitation expired' });
        }
        return {
            email: invitation.email,
            role: invitation.role,
            project_name: invitation.project.name,
            inviter_name: invitation.creator?.name || 'Unknown'
        };
    });
    // Accept invitation
    fastify.post('/api/invitations/:token/accept', async (request, reply) => {
        const tokenHeader = request.headers.authorization?.split(' ')[1];
        if (!tokenHeader) {
            return reply.code(401).send({ error: 'Auth required' });
        }
        let user;
        try {
            user = auth_service_1.default.verifyToken(tokenHeader);
        }
        catch (e) {
            return reply.code(401).send({ error: 'Invalid token' });
        }
        const { token } = request.params;
        const invitation = await prisma.projectInvitation.findUnique({
            where: { token }
        });
        if (!invitation) {
            return reply.code(404).send({ error: 'Invitation not found' });
        }
        if (new Date() > invitation.expires_at) {
            return reply.code(410).send({ error: 'Invitation expired' });
        }
        // Optional: strict email check
        // if (invitation.email !== user.email) { ... }
        // For now, allow accepting with any email as long as they have the link (flexible)
        // Add to project
        try {
            await prisma.projectMember.create({
                data: {
                    project_id: invitation.project_id,
                    user_id: user.id,
                    role: invitation.role
                }
            });
        }
        catch (e) {
            // Ignore if already member
        }
        // Delete invitation
        await prisma.projectInvitation.delete({ where: { token } });
        return { success: true, projectId: invitation.project_id };
    });
    // DELETE member
    fastify.delete('/api/projects/:id/members/:userId', async (request, reply) => {
        const user = request.user;
        const { id, userId } = request.params;
        const projectId = parseInt(id);
        const targetUserId = parseInt(userId);
        const hasAccess = await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner');
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
