import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import yaml from 'js-yaml';
import multiAgentService from '../services/multi_agent.service';
import contentDictionaryService from '../services/content_dictionary.service';
import publicationPlanService from '../services/publication_plan.service';
import parserIntegrationService from '../services/parser_integration.service';
import { normalizeProjectKind, slugifyProjectName } from '../utils/project.utils';

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
        kind?: string;
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

function inferManualContentType(channelType: string, fileType?: string | null) {
    if (channelType === 'linkedin') return 'linkedin:manual_content';
    if (channelType === 'reddit') return 'reddit:manual_content';
    if (channelType === 'tilda') return 'tilda:manual_content';
    if (channelType === 'medium') return 'medium:manual_content';
    if (channelType === 'indiehackers') return 'indiehackers:manual_content';
    if (fileType === 'html') return `${channelType}:manual_html`;
    return `${channelType}:manual_markdown`;
}

function createConnectionId(name: string) {
    const base = slugifyProjectName(name) || 'skill-connection';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseProjectId(raw: string) {
    const value = parseInt(raw, 10);
    if (Number.isNaN(value)) {
        throw new Error('Invalid project id');
    }
    return value;
}

async function makeUniqueProjectSlug(baseSlug?: string, fallbackName?: string, excludeProjectId?: number) {
    const source = baseSlug?.trim() || fallbackName || 'project';
    const normalized = slugifyProjectName(source) || `project-${Date.now()}`;
    let candidate = normalized;
    let suffix = 1;

    while (await prisma.project.findFirst({
        where: {
            slug: candidate,
            ...(excludeProjectId ? { id: { not: excludeProjectId } } : {})
        }
    })) {
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
    const kind = normalizeProjectKind(projectBlock.kind);
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
            kind,
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
        const { name, slug, description, kind } = request.body as any;

        const finalSlug = await makeUniqueProjectSlug(slug, name);
        const project = await prisma.project.create({
            data: {
                name,
                slug: finalSlug,
                description,
                kind: normalizeProjectKind(kind),
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
        const { planJson, planPath, workspaceRoots } = request.body as { planJson?: string; planPath?: string; workspaceRoots?: string[] };

        if (!planJson && !planPath) {
            return reply.code(400).send({ error: 'planJson or planPath is required' });
        }

        try {
            const result = await publicationPlanService.importPlan({
                rawPlan: planJson,
                planPath,
                userId: user.id,
                workspaceRoots: Array.isArray(workspaceRoots) ? workspaceRoots : undefined
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

    fastify.get('/api/projects/:id/parser/health', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            const hasAccess = await authService.hasProjectAccess(user.id, projectId);
            if (!hasAccess) {
                return reply.code(403).send({ error: 'No access' });
            }

            return await parserIntegrationService.getHealth();
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Failed to fetch parser health' });
        }
    });

    fastify.post('/api/projects/:id/parser/search', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            const result = await parserIntegrationService.createSearchJob({
                projectId,
                ...(request.body as any)
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to create parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/search/:jobId', async (request, reply) => {
        const user = (request as any).user;
        const { id, jobId } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.getSearchJob(projectId, jobId, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to fetch parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.post('/api/projects/:id/parser/search/:jobId/refresh', async (request, reply) => {
        const user = (request as any).user;
        const { id, jobId } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            const body = (request.body || {}) as any;
            const result = await parserIntegrationService.refreshSearchJob({
                projectId,
                jobId,
                idempotencyKey: body.idempotencyKey
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to refresh parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/posts', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { limit, offset } = request.query as any;

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.listPosts(projectId, { userId: user.id }, {
                limit: limit !== undefined ? parseInt(limit, 10) : undefined,
                offset: offset !== undefined ? parseInt(offset, 10) : undefined
            });
        } catch (error: any) {
            const message = error.message || 'Failed to list parser posts';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/insights', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { limit, offset, jobId, type } = request.query as any;

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.getInsights({
                projectId,
                limit: limit !== undefined ? parseInt(limit, 10) : undefined,
                offset: offset !== undefined ? parseInt(offset, 10) : undefined,
                jobId,
                type
            }, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to fetch parser insights';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/summaries/:jobId', async (request, reply) => {
        const user = (request as any).user;
        const { id, jobId } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.getSummary({
                projectId,
                jobId
            }, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to fetch parser summary';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/templates', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.listTemplates(projectId, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to list parser templates';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.post('/api/projects/:id/parser/templates/import', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            const result = await parserIntegrationService.importTemplates({
                projectId,
                ...(request.body as any)
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to import parser templates';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.post('/api/projects/:id/parser/templates/:templateId/run', async (request, reply) => {
        const user = (request as any).user;
        const { id, templateId } = request.params as any;

        try {
            const projectId = parseProjectId(id);
            const body = (request.body || {}) as any;
            const result = await parserIntegrationService.runTemplate({
                projectId,
                templateId,
                idempotencyKey: body.idempotencyKey
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to run parser template';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
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

    fastify.post('/api/projects/:id/channels/:channelId/manual-content', async (request, reply) => {
        const user = (request as any).user;
        const { id, channelId } = request.params as any;
        const {
            fileName,
            fileType,
            content,
            note,
            publishedLink,
            publishNow,
            outcome
        } = request.body as {
            fileName?: string;
            fileType?: 'markdown' | 'html' | 'unknown';
            content?: string;
            note?: string;
            publishedLink?: string;
            publishNow?: boolean;
            outcome?: 'published' | 'blocked' | 'removed' | 'restricted';
        };

        const projectId = parseInt(id);
        const parsedChannelId = parseInt(channelId);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        if (!content?.trim()) {
            return reply.code(400).send({ error: 'content is required' });
        }

        const channel = await prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });

        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }

        const safeFileName = (fileName || 'manual-content').trim();
        const title = safeFileName.replace(/\.(md|markdown|html|htm)$/i, '').replace(/[-_]+/g, ' ').trim() || safeFileName;
        const normalizedPublishedLink = publishedLink?.trim() || null;
        const publicationOutcome = outcome || 'published';
        const shouldMarkPublished = publishNow === true && Boolean(normalizedPublishedLink);

        const item = await prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: channel.id,
                type: inferManualContentType(channel.type, fileType || null),
                layer: channel.type,
                title,
                brief: note?.trim() || `Manual ${fileType || 'text'} upload for ${channel.name}`,
                draft_text: content,
                status: shouldMarkPublished ? 'published' : 'drafted',
                assets: {
                    source: 'manual_upload',
                    manual_upload: {
                        file_name: safeFileName,
                        file_type: fileType || 'unknown',
                        note: note || null,
                        published_link: normalizedPublishedLink
                    }
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    content_origin: 'manual_upload',
                    manual_publication_note: note || null,
                    publication_outcome: shouldMarkPublished ? publicationOutcome : null,
                    handoff_bundle: {
                        mode: 'manual',
                        account: {
                            ref: channel.name,
                            details: channel.config || null
                        },
                        task: {
                            id: `manual-${Date.now()}`,
                            display_name: title,
                            channel: channel.type,
                            action_type: 'manual_upload'
                        },
                        publication: {
                            body: content,
                            html_bundle: fileType === 'html' ? [{ file_name: safeFileName }] : [],
                            link_url: normalizedPublishedLink,
                            visuals: []
                        },
                        resource_files: [
                            {
                                role: 'manual_upload',
                                purpose: 'User-provided channel content',
                                file_name: safeFileName,
                                relative_path: null,
                                full_path: null,
                                section_marker: null,
                                exists: true,
                                url: null,
                                content
                            }
                        ],
                        manual_checklist: ['Review the uploaded content and continue the channel workflow.'],
                        verification: [],
                        post_actions: [],
                        dependencies: []
                    }
                } as any,
                metrics: {
                    content_origin: 'manual_upload',
                    channel_ref: channel.name,
                    uploaded_at: new Date().toISOString(),
                    publication_outcome: shouldMarkPublished ? publicationOutcome : null,
                    manual_confirmation_at: shouldMarkPublished ? new Date().toISOString() : null
                } as any
                ,
                published_link: normalizedPublishedLink
            },
            include: {
                channel: true
            }
        });

        return item;
    });

    fastify.put('/api/projects/:id', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { name, slug, description, kind } = request.body as any;
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can edit project details' });
            return;
        }

        const existing = await prisma.project.findUnique({
            where: { id: projectId }
        });

        if (!existing) {
            reply.code(404).send({ error: 'Project not found' });
            return;
        }

        const finalSlug = typeof slug === 'string' && slug.trim()
            ? await makeUniqueProjectSlug(slug, existing.name, existing.id)
            : undefined;

        const project = await prisma.project.update({
            where: { id: projectId },
            data: {
                ...(typeof name === 'string' ? { name } : {}),
                ...(typeof description === 'string' || description === null ? { description } : {}),
                ...(finalSlug ? { slug: finalSlug } : {}),
                ...(typeof kind === 'string' ? { kind: normalizeProjectKind(kind) } : {})
            }
        });

        return project;
    });

    fastify.post('/api/projects/:id/archive', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as any;
        const { archived } = request.body as { archived?: boolean };
        const projectId = parseInt(id);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can archive project details' });
            return;
        }

        const nextArchived = archived !== false;
        const project = await prisma.project.update({
            where: { id: projectId },
            data: {
                is_archived: nextArchived,
                archived_at: nextArchived ? new Date() : null
            }
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
