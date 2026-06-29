"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("../db"));
const publication_plan_service_1 = __importDefault(require("./publication_plan.service"));
const reddit_service_1 = __importDefault(require("./reddit.service"));
const vk_service_1 = __importDefault(require("./vk.service"));
const linkedin_service_1 = __importDefault(require("./linkedin.service"));
const parser_integration_service_1 = __importDefault(require("./parser_integration.service"));
const path_1 = __importDefault(require("path"));
const project_utils_1 = require("../utils/project.utils");
function resolveTaskScheduleAt(item) {
    const actionScheduleAt = item?.assets?.action?.scheduled_at;
    if (typeof actionScheduleAt === 'string' && actionScheduleAt.trim()) {
        return actionScheduleAt;
    }
    return item?.schedule_at?.toISOString?.() || item?.schedule_at || null;
}
function resolveSection(content, marker) {
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.trim() === marker.trim());
    if (startIndex === -1) {
        return '';
    }
    const result = [];
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
function redactConfig(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactConfig(item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const redacted = {};
    for (const [key, fieldValue] of Object.entries(value)) {
        if (/(token|secret|password|session|api[_-]?key|client[_-]?secret|hash|cookie)/i.test(key)) {
            redacted[key] = '[REDACTED]';
            continue;
        }
        redacted[key] = redactConfig(fieldValue);
    }
    return redacted;
}
function normalizeTextPreview(text, maxLength = 280) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) {
        return compact;
    }
    return `${compact.slice(0, maxLength - 1)}…`;
}
async function resolveTelegramPhotoSource(imageUrl) {
    if (imageUrl.startsWith('data:')) {
        const base64Data = imageUrl.split(',')[1];
        return { source: Buffer.from(base64Data, 'base64') };
    }
    if (imageUrl.startsWith('/uploads/')) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
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
    summarizeUser(user) {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            created_at: user.created_at?.toISOString?.() || user.created_at || null,
            projects: Array.isArray(user.memberships)
                ? user.memberships.map((membership) => ({
                    id: membership.project.id,
                    name: membership.project.name,
                    slug: membership.project.slug,
                    is_archived: membership.project.is_archived,
                    role: membership.role
                }))
                : undefined
        };
    }
    summarizeProject(project, role) {
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
                ? project.channels.map((channel) => ({
                    id: channel.id,
                    name: channel.name,
                    type: channel.type,
                    is_active: channel.is_active
                }))
                : undefined,
            role: role || undefined
        };
    }
    async getParserHealth(projectId, userId) {
        return parser_integration_service_1.default.getHealth();
    }
    async createParserSearchJob(params) {
        return parser_integration_service_1.default.createSearchJob({
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
    async getParserSearchJob(projectId, jobId, userId) {
        return parser_integration_service_1.default.getSearchJob(projectId, jobId, { userId });
    }
    async refreshParserSearchJob(projectId, jobId, userId, idempotencyKey) {
        return parser_integration_service_1.default.refreshSearchJob({
            projectId,
            jobId,
            idempotencyKey
        }, { userId, minRole: 'editor' });
    }
    async listParserPosts(projectId, userId, limit, offset) {
        return parser_integration_service_1.default.listPosts(projectId, { userId }, { limit, offset });
    }
    async getParserInsights(projectId, userId, options = {}) {
        return parser_integration_service_1.default.getInsights({
            projectId,
            limit: options.limit,
            offset: options.offset,
            jobId: options.jobId,
            type: options.type
        }, { userId });
    }
    async getParserSummary(projectId, jobId, userId) {
        return parser_integration_service_1.default.getSummary({
            projectId,
            jobId
        }, { userId });
    }
    async listParserTemplates(projectId, userId) {
        return parser_integration_service_1.default.listTemplates(projectId, { userId });
    }
    async importParserTemplates(params) {
        return parser_integration_service_1.default.importTemplates({
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
    async runParserTemplate(projectId, templateId, userId, idempotencyKey) {
        return parser_integration_service_1.default.runTemplate({
            projectId,
            templateId,
            idempotencyKey
        }, { userId, minRole: 'editor' });
    }
    async importPublicationPlanJson(planJson, userId, workspaceRoots) {
        const user = await this.requireUser(userId);
        const result = await publication_plan_service_1.default.importPlan({
            rawPlan: planJson,
            userId,
            workspaceRoots
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
    async importPublicationPlanFile(planPath, userId, workspaceRoots) {
        const user = await this.requireUser(userId);
        const resolvedPlanPath = path_1.default.resolve(planPath);
        const result = await publication_plan_service_1.default.importPlan({
            planPath: resolvedPlanPath,
            userId,
            workspaceRoots
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
    async listProjects(options = {}) {
        const where = {};
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
        const projects = await db_1.default.project.findMany({
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
    getPublicationPlanFormat() {
        return publication_plan_service_1.default.getPublicationPlanFormat();
    }
    getPublicationPlanTemplate(input = {}) {
        return publication_plan_service_1.default.getPublicationPlanTemplate(input);
    }
    normalizePublicationPlan(planJson) {
        return publication_plan_service_1.default.normalizePublicationPlan(planJson);
    }
    async listUsers(options = {}) {
        const users = await db_1.default.user.findMany({
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
    async getUser(userId, options = {}) {
        const user = await db_1.default.user.findUnique({
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
    async createProject(params) {
        const user = await this.requireUser(params.userId);
        const slug = await this.makeUniqueProjectSlug(params.slug, params.name);
        const project = await db_1.default.project.create({
            data: {
                name: params.name,
                slug,
                description: params.description,
                kind: (0, project_utils_1.normalizeProjectKind)(params.kind),
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
    async updateProject(params) {
        await this.assertProjectAccess(params.userId, params.projectId, 'owner');
        const existing = await db_1.default.project.findUnique({
            where: { id: params.projectId }
        });
        if (!existing) {
            throw new Error(`Project ${params.projectId} not found`);
        }
        const slug = typeof params.slug === 'string' && params.slug.trim()
            ? await this.makeUniqueProjectSlug(params.slug, existing.name, existing.id)
            : undefined;
        const project = await db_1.default.project.update({
            where: { id: params.projectId },
            data: {
                ...(typeof params.name === 'string' ? { name: params.name } : {}),
                ...(typeof params.description === 'string' || params.description === null ? { description: params.description } : {}),
                ...(slug ? { slug } : {}),
                ...(typeof params.kind === 'string' ? { kind: (0, project_utils_1.normalizeProjectKind)(params.kind) } : {})
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
    async archiveProject(params) {
        await this.assertProjectAccess(params.userId, params.projectId, 'owner');
        const nextArchived = params.archived !== false;
        const project = await db_1.default.project.update({
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
    async listChannels(projectId) {
        const channels = await db_1.default.socialChannel.findMany({
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
    async listPublicationPlanAssets(projectId) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }
        const pipelineRoot = path_1.default.resolve(plan.meta.pipeline_root || '');
        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            pipeline_root: pipelineRoot,
            assets: Object.entries(plan.assets || {}).map(([ref, asset]) => {
                const runtime = publication_plan_service_1.default.resolveAssetRuntime(plan, ref);
                return {
                    ref,
                    type: asset?.type || null,
                    relative_path: runtime.relative_path || null,
                    full_path: runtime.full_path || null,
                    section_marker: asset?.section_marker || null,
                    target_url: asset?.target_url || null,
                    exists: runtime.exists === true,
                    snapshot_available: runtime.snapshot_available === true,
                    content_source: runtime.content_source || null
                };
            })
        };
    }
    async readPublicationPlanAsset(projectId, assetRef, maxChars = 20000) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }
        const asset = plan.assets?.[assetRef];
        if (!asset) {
            throw new Error(`Asset '${assetRef}' not found in imported publication plan`);
        }
        const runtime = publication_plan_service_1.default.resolveAssetRuntime(plan, assetRef, maxChars);
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
    async refreshPublicationPlanAssetSnapshots(projectId, assetContents = {}) {
        const plan = await this.loadPublicationPlanContext(projectId);
        if (!plan) {
            throw new Error(`No imported publication plan found for project ${projectId}`);
        }
        const overrides = Object.fromEntries(Object.entries(assetContents).map(([ref, value]) => [
            ref,
            {
                content: value.content,
                content_type: value.contentType || null
            }
        ]));
        const snapshots = await publication_plan_service_1.default.refreshAssetSnapshots(projectId, plan, overrides);
        return {
            project_id: projectId,
            plan_id: plan.meta.plan_id,
            snapshots_count: Object.keys(snapshots).length,
            asset_refs: Object.keys(snapshots)
        };
    }
    async readPublicationPlanRef(projectId, ref, maxChars = 20000) {
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
    async getPublicationTaskResources(projectId, taskId, maxChars = 12000) {
        const item = await db_1.default.contentItem.findFirst({
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
        const action = item.assets?.action;
        if (!action) {
            return {
                project_id: projectId,
                task_id: taskId,
                resources: []
            };
        }
        const bundle = publication_plan_service_1.default.buildHandoffBundle({ ...plan, actions: [action] }, item);
        const resources = Array.isArray(bundle.resource_files) ? bundle.resource_files : [];
        return {
            project_id: projectId,
            task_id: taskId,
            resources: resources.map((entry) => {
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
                    content_source: entry.content_source || null,
                    snapshot_available: entry.snapshot_available === true,
                    truncated,
                    content: content ? (truncated ? `${content.slice(0, maxChars)}\n...[truncated]` : content) : null
                };
            })
        };
    }
    async listPublicationTasks(projectId, status, manualOnly) {
        const where = {
            project_id: projectId,
            assets: { not: undefined }
        };
        if (status === 'active') {
            where.status = { in: ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'published', 'failed'] };
        }
        else if (status) {
            where.status = status;
        }
        const items = await db_1.default.contentItem.findMany({
            where,
            include: { channel: true },
            orderBy: { schedule_at: 'asc' }
        });
        const filtered = manualOnly
            ? items.filter((item) => item.quality_report?.execution_mode === 'manual')
            : items;
        return filtered.map((item) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            status: item.status,
            layer: item.layer,
            schedule_at: resolveTaskScheduleAt(item),
            published_link: item.published_link,
            channel: item.channel
                ? {
                    id: item.channel.id,
                    name: item.channel.name,
                    type: item.channel.type
                }
                : null,
            execution_mode: item.quality_report?.execution_mode || null,
            publication_outcome: item.metrics?.publication_outcome || item.quality_report?.publication_outcome || null
        }));
    }
    async getPublicationTask(projectId, taskId) {
        const item = await db_1.default.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { channel: true }
        });
        if (!item) {
            throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
        }
        const plan = await this.loadPublicationPlanContext(projectId);
        const action = item.assets?.action;
        if (!plan || !action) {
            return item;
        }
        const bundle = publication_plan_service_1.default.buildHandoffBundle({ ...plan, actions: [action] }, item);
        return {
            ...item,
            schedule_at: resolveTaskScheduleAt(item),
            quality_report: {
                ...(item.quality_report || {}),
                handoff_bundle: bundle
            }
        };
    }
    async preparePublicationTask(projectId, taskId) {
        const item = await db_1.default.contentItem.findFirst({
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
        const action = item.assets?.action;
        plan.actions = action ? [action] : [];
        const bundle = publication_plan_service_1.default.buildHandoffBundle(plan, item);
        const updated = await db_1.default.contentItem.update({
            where: { id: item.id },
            data: {
                status: bundle.mode === 'manual' ? 'awaiting_manual_publication' : 'ready_for_execution',
                quality_report: {
                    ...(item.quality_report || {}),
                    handoff_bundle: bundle,
                    prepared_at: new Date().toISOString()
                }
            }
        });
        return {
            item: {
                ...updated,
                schedule_at: resolveTaskScheduleAt(updated)
            },
            bundle,
            reused: false
        };
    }
    async confirmPublication(projectId, taskId, publishedLink, note, outcome = 'published') {
        const item = await db_1.default.contentItem.findFirst({
            where: { id: taskId, project_id: projectId }
        });
        if (!item) {
            throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
        }
        const monitoring = item.metrics?.monitoring || {};
        return db_1.default.contentItem.update({
            where: { id: item.id },
            data: {
                status: 'published',
                published_link: publishedLink,
                metrics: {
                    ...(item.metrics || {}),
                    manual_confirmation_at: new Date().toISOString(),
                    publication_outcome: outcome,
                    monitoring: {
                        ...monitoring,
                        awaiting_analytics: true,
                        awaiting_comment_alerts: monitoring.needs_comment_monitoring === true
                    }
                },
                quality_report: {
                    ...(item.quality_report || {}),
                    manual_publication_note: note || null,
                    publication_outcome: outcome
                }
            }
        });
    }
    async publishDirect(params) {
        const channel = await this.resolveChannel(params.projectId, params.channelId, params.channelType);
        const config = channel.config?.raw_account || channel.config;
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
        let publishedLink = null;
        let externalId = null;
        if (channel.type === 'reddit') {
            if (!params.title?.trim()) {
                throw new Error('`title` is required for Reddit publication');
            }
            if (!params.subreddit?.trim()) {
                throw new Error('`subreddit` is required for Reddit publication');
            }
            const result = await reddit_service_1.default.submitDiscussionPost(config, {
                subreddit: params.subreddit,
                title: params.title,
                text: params.text
            });
            publishedLink = result.url;
            externalId = result.name;
        }
        else if (channel.type === 'telegram') {
            const telegramService = require('./telegram.service').default;
            const rawChannelId = channel.config?.telegram_channel_id?.toString();
            if (!rawChannelId) {
                throw new Error(`Telegram channel ${channel.id} is missing telegram_channel_id`);
            }
            const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
            const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                ? localTestChannel
                : rawChannelId;
            let sentMessage;
            let linkMessageId = null;
            if (params.imageUrl) {
                const captionLimit = 1024;
                const photoSource = await resolveTelegramPhotoSource(params.imageUrl);
                if (params.text.length <= captionLimit) {
                    sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                        caption: params.text
                    });
                    linkMessageId = sentMessage?.message_id || null;
                }
                else {
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
            }
            else {
                sentMessage = await telegramService.sendMessage(targetChannelId, params.text);
                linkMessageId = sentMessage?.message_id || null;
            }
            externalId = linkMessageId || sentMessage?.message_id || null;
            const channelUsername = channel.config?.channel_username;
            if (channelUsername && externalId) {
                publishedLink = `https://t.me/${channelUsername}/${externalId}`;
            }
            else if (String(targetChannelId).startsWith('-100') && externalId) {
                publishedLink = `https://t.me/c/${String(targetChannelId).slice(4)}/${externalId}`;
            }
        }
        else if (channel.type === 'vk') {
            const vkId = config?.vk_id;
            const apiKey = config?.api_key;
            if (!vkId || !apiKey) {
                throw new Error(`VK channel ${channel.id} is missing vk_id or api_key`);
            }
            publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, params.text, params.imageUrl);
        }
        else if (channel.type === 'linkedin') {
            const urn = config?.linkedin_urn;
            const token = config?.access_token;
            if (!urn || !token) {
                throw new Error(`LinkedIn channel ${channel.id} is missing linkedin_urn or access_token`);
            }
            publishedLink = await linkedin_service_1.default.publishPost(urn, token, params.text, params.imageUrl);
        }
        else {
            throw new Error(`Direct MCP publication is not supported for channel type '${channel.type}'`);
        }
        await db_1.default.event.create({
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
                }
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
    async resolveChannel(projectId, channelId, channelType) {
        if (channelId) {
            const channel = await db_1.default.socialChannel.findFirst({
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
        const channel = await db_1.default.socialChannel.findFirst({
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
    async requireUser(userId) {
        const user = await db_1.default.user.findUnique({
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
    async assertProjectAccess(userId, projectId, minRole = 'viewer') {
        const membership = await db_1.default.projectMember.findUnique({
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
        const roles = ['viewer', 'editor', 'owner'];
        if (roles.indexOf(membership.role) < roles.indexOf(minRole)) {
            throw new Error(`User ${userId} does not have ${minRole} access to project ${projectId}`);
        }
        return membership;
    }
    async makeUniqueProjectSlug(baseSlug, fallbackName, excludeProjectId) {
        const source = baseSlug?.trim() || fallbackName?.trim() || `project-${Date.now()}`;
        const normalized = (0, project_utils_1.slugifyProjectName)(source) || `project-${Date.now()}`;
        let candidate = normalized;
        let suffix = 2;
        while (await db_1.default.project.findFirst({
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
    resolvePlanRef(plan, ref) {
        if (!ref)
            return null;
        const resolveParts = (parts) => {
            let current = plan;
            for (const part of parts) {
                if (current == null)
                    return null;
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
    resolvePlanPath(pipelineRoot, relativePath) {
        if (!pipelineRoot) {
            throw new Error('Imported publication plan does not define meta.pipeline_root');
        }
        const normalizedRoot = path_1.default.resolve(pipelineRoot);
        const resolvedPath = path_1.default.resolve(normalizedRoot, relativePath);
        const rootWithSep = normalizedRoot.endsWith(path_1.default.sep) ? normalizedRoot : `${normalizedRoot}${path_1.default.sep}`;
        if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(rootWithSep)) {
            throw new Error(`Refusing to read path outside pipeline_root: ${relativePath}`);
        }
        return resolvedPath;
    }
    async loadPublicationPlanContext(projectId) {
        const settings = await db_1.default.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: {
                    in: [
                        'publication_plan_meta',
                        'publication_plan_assets',
                        'publication_plan_accounts',
                        'publication_plan_asset_snapshots',
                        'publication_plan_content_file_snapshots'
                    ]
                }
            }
        });
        const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
        const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
        const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
        const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
        const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;
        if (!meta || !assets || !accounts) {
            return null;
        }
        return {
            meta: JSON.parse(meta),
            assets: JSON.parse(assets),
            accounts: JSON.parse(accounts),
            asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
            content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
            actions: []
        };
    }
}
exports.default = new McpPublicationService();
