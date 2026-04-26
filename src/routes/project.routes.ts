import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import yaml from 'js-yaml';
import multiAgentService from '../services/multi_agent.service';
import contentDictionaryService from '../services/content_dictionary.service';
import publicationPlanService from '../services/publication_plan.service';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const agentSettingKeyMap: Record<string, { prompt: string; key: string; model: string }> = {
    post_creator: {
        prompt: multiAgentService.KEY_POST_CREATOR_PROMPT,
        key: multiAgentService.KEY_POST_CREATOR_KEY,
        model: multiAgentService.KEY_POST_CREATOR_MODEL
    },
    post_critic: {
        prompt: multiAgentService.KEY_POST_CRITIC_PROMPT,
        key: multiAgentService.KEY_POST_CRITIC_KEY,
        model: multiAgentService.KEY_POST_CRITIC_MODEL
    },
    post_fixer: {
        prompt: multiAgentService.KEY_POST_FIXER_PROMPT,
        key: multiAgentService.KEY_POST_FIXER_KEY,
        model: multiAgentService.KEY_POST_FIXER_MODEL
    },
    topic_creator: {
        prompt: multiAgentService.KEY_TOPIC_CREATOR_PROMPT,
        key: multiAgentService.KEY_TOPIC_CREATOR_KEY,
        model: multiAgentService.KEY_TOPIC_CREATOR_MODEL
    },
    topic_critic: {
        prompt: multiAgentService.KEY_TOPIC_CRITIC_PROMPT,
        key: multiAgentService.KEY_TOPIC_CRITIC_KEY,
        model: multiAgentService.KEY_TOPIC_CRITIC_MODEL
    },
    topic_fixer: {
        prompt: multiAgentService.KEY_TOPIC_FIXER_PROMPT,
        key: multiAgentService.KEY_TOPIC_FIXER_KEY,
        model: multiAgentService.KEY_TOPIC_FIXER_MODEL
    },
    visual_architect: {
        prompt: multiAgentService.KEY_VISUAL_ARCHITECT_PROMPT,
        key: multiAgentService.KEY_VISUAL_ARCHITECT_KEY,
        model: multiAgentService.KEY_VISUAL_ARCHITECT_MODEL
    },
    structural_critic: {
        prompt: multiAgentService.KEY_STRUCTURAL_CRITIC_PROMPT,
        key: multiAgentService.KEY_STRUCTURAL_CRITIC_KEY,
        model: multiAgentService.KEY_STRUCTURAL_CRITIC_MODEL
    },
    precision_fixer: {
        prompt: multiAgentService.KEY_PRECISION_FIXER_PROMPT,
        key: multiAgentService.KEY_PRECISION_FIXER_KEY,
        model: multiAgentService.KEY_PRECISION_FIXER_MODEL
    },
    image_critic: {
        prompt: multiAgentService.KEY_IMAGE_CRITIC_PROMPT,
        key: multiAgentService.KEY_IMAGE_CRITIC_KEY,
        model: multiAgentService.KEY_IMAGE_CRITIC_MODEL
    }
};

type ImportedProjectConfig = {
    project?: {
        name?: string;
        slug?: string;
        description?: string;
    };
    settings?: Record<string, unknown>;
    content_dictionary?: unknown;
    provider_keys?: Array<{
        name?: string;
        key?: string;
        provider?: string;
    }>;
    channels?: Array<{
        type?: string;
        name?: string;
        config?: any;
    }>;
    agents?: Record<string, {
        prompt?: string;
        apiKey?: string;
        model?: string;
    }>;
    presets?: Array<{
        name?: string;
        role?: string;
        prompt_text?: string;
    }>;
    skill_connections?: Array<{
        id?: string;
        name?: string;
        provider?: string;
        model?: string;
        providerKeyId?: number;
        providerKeyName?: string;
        endpointType?: string;
        skillMode?: string;
        enabledSkills?: string[];
        systemPrompt?: string;
        notes?: string;
        enabled?: boolean;
        supportsSkills?: boolean;
    }>;
};

function detectProviderFromKey(key: string) {
    if (key.startsWith('sk-ant')) return 'Anthropic';
    if (key.startsWith('AIza')) return 'Gemini';
    if (key.startsWith('sk-')) return 'OpenAI';
    return 'Other';
}

function createConnectionId(name: string) {
    const base = slugifyProjectName(name) || 'skill-connection';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugifyProjectName(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

async function makeUniqueProjectSlug(baseSlug?: string, fallbackName?: string) {
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

function parseImportedProjectConfig(rawConfig: string): ImportedProjectConfig {
    const trimmed = rawConfig.trim();
    if (!trimmed) {
        throw new Error('Configuration is empty');
    }

    const parsed = yaml.load(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Configuration must be a YAML or JSON object');
    }

    return parsed as ImportedProjectConfig;
}

async function buildImportedProjectData(rawConfig: string, userId: number) {
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

    const dictionaryYaml = parsed.content_dictionary !== undefined
        ? contentDictionaryService.normalizeToYaml(parsed.content_dictionary)
        : null;

    const channels = (parsed.channels || []).map((channel, index) => {
        if (!channel?.type || !channel?.name) {
            throw new Error(`channels[${index}] must include both type and name`);
        }

        return {
            type: channel.type.trim(),
            name: channel.name.trim(),
            config: (channel.config || {}) as any
        };
    });

    const providerKeys = (parsed.provider_keys || []).map((providerKey, index) => {
        if (!providerKey?.name || !providerKey?.key) {
            throw new Error(`provider_keys[${index}] must include name and key`);
        }

        return {
            name: providerKey.name.trim(),
            key: providerKey.key.trim(),
            provider: providerKey.provider?.trim() || detectProviderFromKey(providerKey.key.trim())
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

        const entries: Array<{ key: string; value: string }> = [];
        if (config?.prompt !== undefined) entries.push({ key: keys.prompt, value: String(config.prompt) });
        if (config?.apiKey !== undefined) entries.push({ key: keys.key, value: String(config.apiKey) });
        if (config?.model !== undefined) entries.push({ key: keys.model, value: String(config.model) });
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

    const skillConnections = (parsed.skill_connections || []).map((connection, index) => {
        if (!connection?.name || !connection?.provider || !connection?.model) {
            throw new Error(`skill_connections[${index}] must include name, provider and model`);
        }

        const providerKeyName = connection.providerKeyName?.trim();
        if (providerKeyName && !providerKeys.find((key) => key.name === providerKeyName)) {
            throw new Error(`skill_connections[${index}] references unknown provider key: ${providerKeyName}`);
        }

        return {
            id: connection.id?.trim() || createConnectionId(connection.name),
            name: connection.name.trim(),
            provider: connection.provider.trim(),
            model: connection.model.trim(),
            providerKeyId: typeof connection.providerKeyId === 'number' ? connection.providerKeyId : null,
            providerKeyName: providerKeyName || null,
            endpointType: connection.endpointType?.trim() || 'native',
            skillMode: connection.skillMode?.trim() || 'native_skills',
            enabledSkills: Array.isArray(connection.enabledSkills)
                ? connection.enabledSkills.map((skill) => String(skill).trim()).filter(Boolean)
                : [],
            systemPrompt: connection.systemPrompt || '',
            notes: connection.notes || '',
            enabled: connection.enabled !== false,
            supportsSkills: connection.supportsSkills !== false
        };
    });

    const uniqueSettings = Array.from(
        new Map(
            [
                ...settings,
                ...agentSettings,
                ...(dictionaryYaml ? [{ key: 'content_dictionary_yaml', value: dictionaryYaml }] : [])
            ].map((setting) => [setting.key, setting])
        ).values()
    );

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
        providerKeys,
        channels,
        presets,
        skillConnections
    };
}

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
        const user = (request as any).user;
        const { config } = request.body as { config?: string };

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

                const createdProviderKeys = new Map<string, number>();

                for (const providerKey of imported.providerKeys) {
                    const createdKey = await tx.providerKey.create({
                        data: {
                            project_id: createdProject.id,
                            name: providerKey.name,
                            key: providerKey.key,
                            provider: providerKey.provider
                        }
                    });

                    createdProviderKeys.set(providerKey.name, createdKey.id);
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

                if (imported.skillConnections.length > 0) {
                    await tx.projectSettings.create({
                        data: {
                            project_id: createdProject.id,
                            key: 'llm_skill_connections',
                            value: JSON.stringify(
                                imported.skillConnections.map((connection) => ({
                                    ...connection,
                                    providerKeyId: connection.providerKeyName
                                        ? (createdProviderKeys.get(connection.providerKeyName) || null)
                                        : connection.providerKeyId
                                }))
                            )
                        }
                    });
                }

                return createdProject;
            });

            return {
                ...project,
                imported: {
                    settings: imported.settings.length,
                    providerKeys: imported.providerKeys.length,
                    channels: imported.channels.length,
                    presets: imported.presets.length,
                    skillConnections: imported.skillConnections.length
                }
            };
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Failed to import project configuration' });
        }
    });

    fastify.post('/api/projects/import-publication-plan', async (request, reply) => {
        const user = (request as any).user;
        const { planJson, planPath } = request.body as { planJson?: string; planPath?: string };

        if (!planJson && !planPath) {
            return reply.code(400).send({ error: 'planJson or planPath is required' });
        }

        try {
            const result = await publicationPlanService.importPlan({
                rawPlan: planJson,
                planPath,
                userId: user.id
            });

            return result;
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Failed to import publication plan' });
        }
    });



    // Update project settings
    fastify.post('/api/projects/:id/settings', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { key, value } = request.body as any;
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
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
        const { token } = request.params as any;

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
            user = authService.verifyToken(tokenHeader);
        } catch (e) {
            return reply.code(401).send({ error: 'Invalid token' });
        }

        const { token } = request.params as any;

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
        } catch (e) {
            // Ignore if already member
        }

        // Delete invitation
        await prisma.projectInvitation.delete({ where: { token } });

        return { success: true, projectId: invitation.project_id };
    });
    // DELETE member
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
