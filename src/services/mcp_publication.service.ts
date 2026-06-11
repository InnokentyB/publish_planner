import prisma from '../db';
import publicationPlanService from './publication_plan.service';
import redditService from './reddit.service';
import vkService from './vk.service';
import linkedinService from './linkedin.service';
import parserIntegrationService from './parser_integration.service';
import fs from 'fs';
import path from 'path';
import { normalizeProjectKind, slugifyProjectName } from '../utils/project.utils';

type PublicationOutcome = 'published' | 'blocked' | 'removed' | 'restricted';

type DirectPublishParams = {
    projectId: number;
    channelId?: number;
    channelType?: string;
    title?: string;
    text: string;
    subreddit?: string;
    imageUrl?: string;
    dryRun?: boolean;
};

type ProjectRole = 'owner' | 'editor' | 'viewer';

function resolveSection(content: string, marker: string) {
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.trim() === marker.trim());
    if (startIndex === -1) {
        return '';
    }

    const result: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
            break;
        }
        result.push(lines[i]);
    }

    return result
        .join('\n')
        .replace(/\*\*Content Note\*\*[\s\S]*?(?=\n#|\n---|$)/g, '')
        .trim();
}

function redactConfig(value: any): any {
    if (Array.isArray(value)) {
        return value.map((item) => redactConfig(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const redacted: Record<string, any> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
        if (/(token|secret|password|session|api[_-]?key|client[_-]?secret|hash|cookie)/i.test(key)) {
            redacted[key] = '[REDACTED]';
            continue;
        }

        redacted[key] = redactConfig(fieldValue);
    }

    return redacted;
}

function normalizeTextPreview(text: string, maxLength = 280) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) {
        return compact;
    }

    return `${compact.slice(0, maxLength - 1)}…`;
}

async function resolveTelegramPhotoSource(imageUrl: string): Promise<string | { source: Buffer } | { source: NodeJS.ReadableStream }> {
    if (imageUrl.startsWith('data:')) {
        const base64Data = imageUrl.split(',')[1];
        return { source: Buffer.from(base64Data, 'base64') };
    }

    if (imageUrl.startsWith('/uploads/')) {
        const fs = await import('fs');
        const path = await import('path');
        const filename = imageUrl.split('/').pop();
        const localPath = path.join(__dirname, '../../uploads', filename || '');
        if (!fs.existsSync(localPath)) {
            throw new Error(`Local image file not found: ${localPath}`);
        }
        return { source: fs.createReadStream(localPath) };
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return imageUrl;
    }

    throw new Error(`Unsupported image format: ${imageUrl}`);
}

class McpPublicationService {
    private summarizeUser(user: any) {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            created_at: user.created_at?.toISOString?.() || user.created_at || null,
            projects: Array.isArray(user.memberships)
                ? user.memberships.map((membership: any) => ({
                    id: membership.project.id,
                    name: membership.project.name,
                    slug: membership.project.slug,
                    is_archived: membership.project.is_archived,
                    role: membership.role
                }))
                : undefined
        };
    }

    private summarizeProject(project: any, role?: string | null) {
        return {
            id: project.id,
            name: project.name,
            slug: project.slug,
            description: project.description,
            kind: project.kind,
            is_archived: project.is_archived,
            archived_at: project.archived_at?.toISOString() || null,
            updated_at: project.updated_at.toISOString(),
            channels_count: project._count?.channels ?? 0,
            content_items_count: project._count?.content_items ?? 0,
            channels: Array.isArray(project.channels)
                ? project.channels.map((channel: any) => ({
                    id: channel.id,
                    name: channel.name,
                    type: channel.type,
                    is_active: channel.is_active
                }))
                : undefined,
            role: role || undefined
        };
    }

    async getParserHealth(projectId: number, userId: number) {
        return parserIntegrationService.getHealth();
    }

    async createParserSearchJob(params: {
        userId: number;
        projectId: number;
        source?: 'reddit' | 'indie_hackers';
        query: string;
        subreddit?: string;
        subreddits?: string[];
        queryDefinitionId?: string;
        intent?: string;
        cluster?: string;
        priority?: number;
        matchMustIncludeAny?: string[];
        excludeIfContains?: string[];
        excludeRegexes?: string[];
        limit?: number;
        minScore?: number;
        dateFrom?: string;
        dateTo?: string;
        includeComments?: boolean;
        enrich?: boolean;
        idempotencyKey?: string;
    }) {
        return parserIntegrationService.createSearchJob({
            projectId: params.projectId,
            source: params.source,
            query: params.query,
            subreddit: params.subreddit,
            subreddits: params.subreddits,
            queryDefinitionId: params.queryDefinitionId,
            intent: params.intent,
            cluster: params.cluster,
            priority: params.priority,
            matchMustIncludeAny: params.matchMustIncludeAny,
            excludeIfContains: params.excludeIfContains,
            excludeRegexes: params.excludeRegexes,
            limit: params.limit,
            minScore: params.minScore,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            includeComments: params.includeComments,
            enrich: params.enrich,
            idempotencyKey: params.idempotencyKey
        }, { userId: params.userId, minRole: 'editor' });
    }

    async getParserSearchJob(projectId: number, jobId: string, userId: number) {
        return parserIntegrationService.getSearchJob(projectId, jobId, { userId });
    }

    async refreshParserSearchJob(projectId: number, jobId: string, userId: number, idempotencyKey?: string) {
        return parserIntegrationService.refreshSearchJob({
            projectId,
            jobId,
            idempotencyKey
        }, { userId, minRole: 'editor' });
    }

    async listParserPosts(projectId: number, userId: number, limit?: number, offset?: number) {
        return parserIntegrationService.listPosts(projectId, { userId }, { limit, offset });
    }

    async getParserInsights(projectId: number, userId: number, options: {
        limit?: number;
        offset?: number;
        jobId?: string;
        type?: string;
    } = {}) {
        return parserIntegrationService.getInsights({
            projectId,
            limit: options.limit,
            offset: options.offset,
            jobId: options.jobId,
            type: options.type
        }, { userId });
    }

    async getParserSummary(projectId: number, jobId: string, userId: number) {
        return parserIntegrationService.getSummary({
            projectId,
            jobId
        }, { userId });
    }

    async listParserTemplates(projectId: number, userId: number) {
        return parserIntegrationService.listTemplates(projectId, { userId });
    }

    async importParserTemplates(params: {
        userId: number;
        projectId: number;
        yamlContent?: string;
        queryBank?: Record<string, any>;
        scheduleDaily?: boolean;
        limit?: number;
        minScore?: number;
        dateFrom?: string;
        dateTo?: string;
        includeComments?: boolean;
        enrich?: boolean;
        idempotencyKey?: string;
    }) {
        return parserIntegrationService.importTemplates({
            projectId: params.projectId,
            yamlContent: params.yamlContent,
            queryBank: params.queryBank,
            scheduleDaily: params.scheduleDaily,
            limit: params.limit,
            minScore: params.minScore,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            includeComments: params.includeComments,
            enrich: params.enrich,
            idempotencyKey: params.idempotencyKey
        }, { userId: params.userId, minRole: 'editor' });
    }

    async runParserTemplate(projectId: number, templateId: string, userId: number, idempotencyKey?: string) {
        return parserIntegrationService.runTemplate({
            projectId,
            templateId,
            idempotencyKey
        }, { userId, minRole: 'editor' });
    }

    async importPublicationPlanJson(planJson: string, userId: number) {
        const user = await this.requireUser(userId);

        const result = await publicationPlanService.importPlan({
            rawPlan: planJson,
            userId
        });

        return {
            imported_by: user,
            project: {
                id: result.project.id,
                name: result.project.name,
                slug: result.project.slug,
                description: result.project.description
            },
            imported: result.imported
        };
    }

    async importPublicationPlanFile(planPath: string, userId: number) {
        const user = await this.requireUser(userId);
        const resolvedPlanPath = path.resolve(planPath);

        const result = await publicationPlanService.importPlan({
            planPath: resolvedPlanPath,
            userId
        });

        return {
            imported_by: user,
            source: {
                plan_path: resolvedPlanPath
            },
            project: {
                id: result.project.id,
                name: result.project.name,
                slug: result.project.slug,
                description: result.project.description
            },
            imported: result.imported
        };
    }

    async listProjects(options: { userId?: number; includeArchived?: boolean } = {}) {
        const where: any = {};

        if (options.userId) {
            where.members = {
                some: {
                    user_id: options.userId
                }
            };
        }

        if (!options.includeArchived) {
            where.is_archived = false;
        }

        const projects = await prisma.project.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            include: {
                members: options.userId
                    ? {
                        where: { user_id: options.userId },
                        select: { role: true }
                    }
                    : false,
                channels: {
                    orderBy: { id: 'asc' },
                    take: 12
                },
                _count: {
                    select: {
                        channels: true,
                        content_items: true
                    }
                }
            }
        });

        return projects.map((project) => this.summarizeProject(project, project.members?.[0]?.role || null));
    }

    async listUsers(options: { includeArchivedProjects?: boolean } = {}) {
        const users = await prisma.user.findMany({
            orderBy: { id: 'asc' },
            include: {
                memberships: {
                    where: options.includeArchivedProjects
                        ? undefined
                        : {
                            project: {
                                is_archived: false
                            }
                        },
                    orderBy: { project_id: 'asc' },
                    include: {
                        project: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                                is_archived: true
                            }
                        }
                    }
                }
            }
        });

        return users.map((user) => this.summarizeUser(user));
    }

    async getUser(userId: number, options: { includeArchivedProjects?: boolean } = {}) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                memberships: {
                    where: options.includeArchivedProjects
                        ? undefined
                        : {
                            project: {
                                is_archived: false
                            }
                        },
                    orderBy: { project_id: 'asc' },
                    include: {
                        project: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                                is_archived: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) {
            throw new Error(`User ${userId} not found`);
        }

        return this.summarizeUser(user);
    }

    async createProject(params: {
        userId: number;
        name: string;
        slug?: string;
        description?: string;
        kind?: string;
    }) {
        const user = await this.requireUser(params.userId);
        const slug = await this.makeUniqueProjectSlug(params.slug, params.name);

        const project = await prisma.project.create({
            data: {
                name: params.name,
                slug,
                description: params.description,
                kind: normalizeProjectKind(params.kind),
                members: {
                    create: {
                        user_id: params.userId,
                        role: 'owner'
                    }
                }
            },
            include: {
                channels: {
                    orderBy: { id: 'asc' },
                    take: 12
                },
                _count: {
                    select: {
                        channels: true,
                        content_items: true
                    }
                }
            }
        });

        return {
            created_by: user,
            project: this.summarizeProject(project, 'owner')
        };
    }

    async updateProject(params: {
        userId: number;
        projectId: number;
        name?: string;
        slug?: string;
        description?: string | null;
        kind?: string;
    }) {
        await this.assertProjectAccess(params.userId, params.projectId, 'owner');

        const existing = await prisma.project.findUnique({
            where: { id: params.projectId }
        });

        if (!existing) {
            throw new Error(`Project ${params.projectId} not found`);
        }

        const slug = typeof params.slug === 'string' && params.slug.trim()
            ? await this.makeUniqueProjectSlug(params.slug, existing.name, existing.id)
            : undefined;

        const project = await prisma.project.update({
            where: { id: params.projectId },
            data: {
                ...(typeof params.name === 'string' ? { name: params.name } : {}),
                ...(typeof params.description === 'string' || params.description === null ? { description: params.description } : {}),
                ...(slug ? { slug } : {}),
                ...(typeof params.kind === 'string' ? { kind: normalizeProjectKind(params.kind) } : {})
            },
            include: {
                channels: {
                    orderBy: { id: 'asc' },
                    take: 12
                },
                _count: {
                    select: {
                        channels: true,
                        content_items: true
                    }
                }
            }
        });

        return {
            project: this.summarizeProject(project, 'owner')
        };
    }

    async archiveProject(params: {
        userId: number;
        projectId: number;
        archived?: boolean;
    }) {
        await this.assertProjectAccess(params.userId, params.projectId, 'owner');
        const nextArchived = params.archived !== false;

        const project = await prisma.project.update({
            where: { id: params.projectId },
            data: {
                is_archived: nextArchived,
                archived_at: nextArchived ? new Date() : null
            },
            include: {
                channels: {
                    orderBy: { id: 'asc' },
                    take: 12
                },
                _count: {
                    select: {
                        channels: true,
                        content_items: true
                    }
                }
            }
        });

        return {
            project: this.summarizeProject(project, 'owner')
        };
    }

    async listChannels(projectId: number) {
        const channels = await prisma.socialChannel.findMany({
            where: { project_id: projectId },
            orderBy: { id: 'asc' }
        });

        return channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            is_active: channel.is_active,
            config: redactConfig(channel.config)
        }));
    }

    async listPublicationPlanAssets(projectId: number) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }

        const pipelineRoot = path.resolve(plan.meta.pipeline_root || '');
        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            pipeline_root: pipelineRoot,
            assets: Object.entries(plan.assets || {}).map(([ref, asset]) => {
                const runtime = publicationPlanService.resolveAssetRuntime(plan as any, ref);

                return {
                    ref,
                    type: (asset as any)?.type || null,
                    relative_path: runtime.relative_path || null,
                    full_path: runtime.full_path || null,
                    section_marker: (asset as any)?.section_marker || null,
                    target_url: (asset as any)?.target_url || null,
                    exists: runtime.exists === true,
                    snapshot_available: runtime.snapshot_available === true,
                    content_source: runtime.content_source || null
                };
            })
        };
    }

    async readPublicationPlanAsset(projectId: number, assetRef: string, maxChars = 20000) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }

        const asset = plan.assets?.[assetRef];
        if (!asset) {
            throw new Error(`Asset '${assetRef}' not found in imported publication plan`);
        }

        const runtime = publicationPlanService.resolveAssetRuntime(plan as any, assetRef, maxChars);

        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            asset_ref: assetRef,
            asset,
            relative_path: runtime.relative_path || null,
            full_path: runtime.full_path || null,
            exists: runtime.exists === true,
            section_marker: runtime.section_marker || null,
            truncated: runtime.truncated === true,
            snapshot_available: runtime.snapshot_available === true,
            content_source: runtime.content_source || null,
            content: runtime.content || null
        };
    }

    async refreshPublicationPlanAssetSnapshots(projectId: number, assetContents: Record<string, { content: string; contentType?: string }> = {}) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }

        const overrides = Object.fromEntries(
            Object.entries(assetContents).map(([ref, value]) => [
                ref,
                {
                    content: value.content,
                    content_type: value.contentType || null
                }
            ])
        );

        const snapshots = await publicationPlanService.refreshAssetSnapshots(projectId, plan as any, overrides);
        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            snapshots_count: Object.keys(snapshots).length,
            asset_refs: Object.keys(snapshots)
        };
    }

    async readPublicationPlanRef(projectId: number, ref: string, maxChars = 20000) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }

        const resolved = this.resolvePlanRef(plan, ref);
        if (resolved == null) {
            throw new Error(`Reference '${ref}' could not be resolved`);
        }

        const assetRef = ref.split('.')[0];
        const asset = plan.assets?.[assetRef];

        if (asset && typeof resolved === 'object' && resolved !== null && 'path' in resolved) {
            const assetRead = await this.readPublicationPlanAsset(projectId, assetRef, maxChars);
            return {
                project_id: projectId,
                plan_id: plan.meta.plan_id,
                ref,
                resolved_type: 'asset',
                resolved_value: resolved,
                asset: assetRead
            };
        }

        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            ref,
            resolved_type: Array.isArray(resolved) ? 'array' : typeof resolved,
            resolved_value: resolved
        };
    }

    async getPublicationTaskResources(projectId: number, taskId: number, maxChars = 12000) {
        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
        }

        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }

        const action = (item.assets as any)?.action;
        if (!action) {
            return {
                project_id: projectId,
                task_id: taskId,
                resources: []
            };
        }

        const bundle = publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as any, item);
        const resources = Array.isArray(bundle.resource_files) ? bundle.resource_files : [];

        return {
            project_id: projectId,
            task_id: taskId,
            resources: resources.map((entry: any) => {
                const content = typeof entry.content === 'string' ? entry.content : null;
                const truncated = Boolean(content && content.length > maxChars);

                return {
                    ref: entry.ref || null,
                    type: entry.type || null,
                    role: entry.role || null,
                    purpose: entry.purpose || null,
                    relative_path: entry.relative_path || null,
                    full_path: entry.full_path || null,
                    section_marker: entry.section_marker || null,
                    exists: entry.exists === true,
                    url: entry.url || null,
                    truncated,
                    content: content ? (truncated ? `${content.slice(0, maxChars)}\n...[truncated]` : content) : null
                };
            })
        };
    }

    async listPublicationTasks(projectId: number, status?: string, manualOnly?: boolean) {
        const where: any = {
            project_id: projectId,
            assets: { not: undefined }
        };

        if (status === 'active') {
            where.status = { in: ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'published', 'failed'] };
        } else if (status) {
            where.status = status;
        }

        const items = await prisma.contentItem.findMany({
            where,
            include: { channel: true },
            orderBy: { schedule_at: 'asc' }
        });

        const filtered = manualOnly
            ? items.filter((item) => (item.quality_report as any)?.execution_mode === 'manual')
            : items;

        return filtered.map((item) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            status: item.status,
            layer: item.layer,
            schedule_at: item.schedule_at?.toISOString() || null,
            published_link: item.published_link,
            channel: item.channel
                ? {
                    id: item.channel.id,
                    name: item.channel.name,
                    type: item.channel.type
                }
                : null,
            execution_mode: (item.quality_report as any)?.execution_mode || null,
            publication_outcome: (item.metrics as any)?.publication_outcome || (item.quality_report as any)?.publication_outcome || null
        }));
    }

    async getPublicationTask(projectId: number, taskId: number) {
        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
        }

        const plan = await this.loadPublicationPlanContext(projectId);
        const action = (item.assets as any)?.action;
        if (!plan || !action) {
            return item;
        }

        const bundle = publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as any, item);
        return {
            ...item,
            quality_report: {
                ...((item.quality_report as any) || {}),
                handoff_bundle: bundle
            }
        };
    }

    async preparePublicationTask(projectId: number, taskId: number) {
        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
        }

        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            return {
                item,
                bundle: null,
                reused: false,
                warning: 'No imported publication plan context is available for this task.'
            };
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
            bundle,
            reused: false
        };
    }

    async confirmPublication(projectId: number, taskId: number, publishedLink: string, note?: string, outcome: PublicationOutcome = 'published') {
        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId }
        });

        if (!item) {
            throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
        }

        const monitoring = (item.metrics as any)?.monitoring || {};
        return prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: 'published',
                published_link: publishedLink,
                metrics: {
                    ...((item.metrics as any) || {}),
                    manual_confirmation_at: new Date().toISOString(),
                    publication_outcome: outcome,
                    monitoring: {
                        ...monitoring,
                        awaiting_analytics: true,
                        awaiting_comment_alerts: monitoring.needs_comment_monitoring === true
                    }
                } as any,
                quality_report: {
                    ...((item.quality_report as any) || {}),
                    manual_publication_note: note || null,
                    publication_outcome: outcome
                } as any
            }
        });
    }

    async publishDirect(params: DirectPublishParams) {
        const channel = await this.resolveChannel(params.projectId, params.channelId, params.channelType);
        const config = (channel.config as any)?.raw_account || channel.config;

        if (params.dryRun) {
            return {
                mode: 'dry_run',
                project_id: params.projectId,
                channel: {
                    id: channel.id,
                    name: channel.name,
                    type: channel.type
                },
                payload_preview: {
                    title: params.title || null,
                    text_preview: normalizeTextPreview(params.text),
                    subreddit: params.subreddit || null,
                    has_image: Boolean(params.imageUrl)
                }
            };
        }

        let publishedLink: string | null = null;
        let externalId: string | number | null = null;

        if (channel.type === 'reddit') {
            if (!params.title?.trim()) {
                throw new Error('`title` is required for Reddit publication');
            }
            if (!params.subreddit?.trim()) {
                throw new Error('`subreddit` is required for Reddit publication');
            }

            const result = await redditService.submitDiscussionPost(config, {
                subreddit: params.subreddit,
                title: params.title,
                text: params.text
            });
            publishedLink = result.url;
            externalId = result.name;
        } else if (channel.type === 'telegram') {
            const telegramService = require('./telegram.service').default;
            const rawChannelId = (channel.config as any)?.telegram_channel_id?.toString();
            if (!rawChannelId) {
                throw new Error(`Telegram channel ${channel.id} is missing telegram_channel_id`);
            }

            const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
            const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                ? localTestChannel
                : rawChannelId;

            let sentMessage: any;
            let linkMessageId: number | null = null;

            if (params.imageUrl) {
                const captionLimit = 1024;
                const photoSource = await resolveTelegramPhotoSource(params.imageUrl);

                if (params.text.length <= captionLimit) {
                    sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                        caption: params.text
                    });
                    linkMessageId = sentMessage?.message_id || null;
                } else {
                    let splitIndex = params.text.lastIndexOf('\n', captionLimit);
                    if (splitIndex === -1 || splitIndex < Math.floor(captionLimit * 0.5)) {
                        splitIndex = params.text.lastIndexOf(' ', captionLimit);
                    }
                    if (splitIndex === -1) {
                        splitIndex = captionLimit;
                    }

                    const caption = params.text.substring(0, splitIndex);
                    const remainder = params.text.substring(splitIndex).trim();

                    const photoMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                        caption
                    });
                    linkMessageId = photoMessage?.message_id || null;

                    sentMessage = remainder
                        ? await telegramService.sendMessage(targetChannelId, remainder, {
                            reply_to_message_id: photoMessage?.message_id
                        })
                        : photoMessage;
                }
            } else {
                sentMessage = await telegramService.sendMessage(targetChannelId, params.text);
                linkMessageId = sentMessage?.message_id || null;
            }

            externalId = linkMessageId || sentMessage?.message_id || null;
            const channelUsername = (channel.config as any)?.channel_username;
            if (channelUsername && externalId) {
                publishedLink = `https://t.me/${channelUsername}/${externalId}`;
            } else if (String(targetChannelId).startsWith('-100') && externalId) {
                publishedLink = `https://t.me/c/${String(targetChannelId).slice(4)}/${externalId}`;
            }
        } else if (channel.type === 'vk') {
            const vkId = config?.vk_id;
            const apiKey = config?.api_key;
            if (!vkId || !apiKey) {
                throw new Error(`VK channel ${channel.id} is missing vk_id or api_key`);
            }

            publishedLink = await vkService.publishPost(vkId, apiKey, params.text, params.imageUrl);
        } else if (channel.type === 'linkedin') {
            const urn = config?.linkedin_urn;
            const token = config?.access_token;
            if (!urn || !token) {
                throw new Error(`LinkedIn channel ${channel.id} is missing linkedin_urn or access_token`);
            }

            publishedLink = await linkedinService.publishPost(urn, token, params.text, params.imageUrl);
        } else {
            throw new Error(`Direct MCP publication is not supported for channel type '${channel.type}'`);
        }

        await prisma.event.create({
            data: {
                entity_type: 'project',
                entity_id: params.projectId,
                event_type: 'mcp.direct_publication',
                payload: {
                    channel_id: channel.id,
                    channel_type: channel.type,
                    title: params.title || null,
                    subreddit: params.subreddit || null,
                    published_link: publishedLink,
                    external_id: externalId,
                    has_image: Boolean(params.imageUrl),
                    text_preview: normalizeTextPreview(params.text, 500)
                } as any
            }
        });

        return {
            mode: 'published',
            project_id: params.projectId,
            channel: {
                id: channel.id,
                name: channel.name,
                type: channel.type
            },
            published_link: publishedLink,
            external_id: externalId
        };
    }

    private async resolveChannel(projectId: number, channelId?: number, channelType?: string) {
        if (channelId) {
            const channel = await prisma.socialChannel.findFirst({
                where: {
                    id: channelId,
                    project_id: projectId,
                    is_active: true
                }
            });

            if (!channel) {
                throw new Error(`Channel ${channelId} not found or inactive for project ${projectId}`);
            }

            return channel;
        }

        if (!channelType) {
            throw new Error('Either `channelId` or `channelType` must be provided');
        }

        const channel = await prisma.socialChannel.findFirst({
            where: {
                project_id: projectId,
                type: channelType,
                is_active: true
            },
            orderBy: { id: 'asc' }
        });

        if (!channel) {
            throw new Error(`No active channel of type '${channelType}' found for project ${projectId}`);
        }

        return channel;
    }

    private async requireUser(userId: number) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true
            }
        });

        if (!user) {
            throw new Error(`User ${userId} not found`);
        }

        return user;
    }

    private async assertProjectAccess(userId: number, projectId: number, minRole: ProjectRole = 'viewer') {
        const membership = await prisma.projectMember.findUnique({
            where: {
                project_id_user_id: {
                    project_id: projectId,
                    user_id: userId
                }
            }
        });

        if (!membership) {
            throw new Error(`User ${userId} does not have access to project ${projectId}`);
        }

        const roles: ProjectRole[] = ['viewer', 'editor', 'owner'];
        if (roles.indexOf(membership.role as ProjectRole) < roles.indexOf(minRole)) {
            throw new Error(`User ${userId} does not have ${minRole} access to project ${projectId}`);
        }

        return membership;
    }

    private async makeUniqueProjectSlug(baseSlug?: string, fallbackName?: string, excludeProjectId?: number) {
        const source = baseSlug?.trim() || fallbackName?.trim() || `project-${Date.now()}`;
        const normalized = slugifyProjectName(source) || `project-${Date.now()}`;
        let candidate = normalized;
        let suffix = 2;

        while (await prisma.project.findFirst({
            where: {
                slug: candidate,
                ...(excludeProjectId ? { id: { not: excludeProjectId } } : {})
            },
            select: { id: true }
        })) {
            candidate = `${normalized}-${suffix}`;
            suffix += 1;
        }

        return candidate;
    }

    private resolvePlanRef(plan: any, ref?: string | null): any {
        if (!ref) return null;

        const resolveParts = (parts: string[]) => {
            let current: any = plan;
            for (const part of parts) {
                if (current == null) return null;
                current = current[part];
            }
            return current ?? null;
        };

        const parts = ref.split('.');
        const direct = resolveParts(parts);
        if (direct != null) {
            return direct;
        }

        const root = parts[0];
        if (plan.assets && root in plan.assets) {
            return resolveParts(['assets', ...parts]);
        }

        if (plan.accounts && root in plan.accounts) {
            return resolveParts(['accounts', ...parts]);
        }

        if (plan.meta && root in plan.meta) {
            return resolveParts(['meta', ...parts]);
        }

        return null;
    }

    private resolvePlanPath(pipelineRoot: string, relativePath: string) {
        if (!pipelineRoot) {
            throw new Error('Imported publication plan does not define meta.pipeline_root');
        }

        const normalizedRoot = path.resolve(pipelineRoot);
        const resolvedPath = path.resolve(normalizedRoot, relativePath);
        const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;

        if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(rootWithSep)) {
            throw new Error(`Refusing to read path outside pipeline_root: ${relativePath}`);
        }

        return resolvedPath;
    }

    private async loadPublicationPlanContext(projectId: number) {
        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts', 'publication_plan_asset_snapshots'] }
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
            asset_snapshots: settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value
                ? JSON.parse(settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')!.value)
                : {},
            actions: [] as any[]
        };
    }
}

export default new McpPublicationService();
