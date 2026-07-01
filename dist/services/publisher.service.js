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
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const telegram_service_1 = __importDefault(require("./telegram.service"));
const vk_service_1 = __importDefault(require("./vk.service"));
const storage_service_1 = __importDefault(require("./storage.service"));
const publication_plan_service_1 = __importDefault(require("./publication_plan.service"));
const reddit_service_1 = __importDefault(require("./reddit.service"));
const gsc_service_1 = __importDefault(require("./gsc.service"));
const tilda_service_1 = __importDefault(require("./tilda.service"));
const linkedin_service_1 = __importDefault(require("./linkedin.service"));
const publication_runtime_helpers_1 = require("./publication_runtime.helpers");
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
// --- Simple File Logger ---
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const PUBLISHER_LOG_FILE = path.join(LOGS_DIR, 'publisher.log');
function logToFile(level, message, data) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    if (data) {
        logLine += ` | ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }
    logLine += '\n';
    // Write to file
    fs.appendFileSync(PUBLISHER_LOG_FILE, logLine);
    // Also log to console
    if (level === 'ERROR')
        console.error(message, data || '');
    else if (level === 'WARN')
        console.warn(message, data || '');
    else
        console.log(message, data || '');
}
class PublisherService {
    async findDependencyItems(projectId, dependencyTaskIds) {
        if (dependencyTaskIds.length === 0)
            return [];
        return prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                OR: dependencyTaskIds.map((dep) => ({
                    metrics: {
                        path: ['task_id'],
                        equals: dep
                    }
                }))
            },
            select: {
                id: true,
                status: true,
                title: true,
                metrics: true,
                updated_at: true
            }
        });
    }
    async loadPublicationPlanContext(projectId) {
        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: {
                    in: [
                        'publication_plan_meta',
                        'publication_plan_assets',
                        'publication_plan_accounts',
                        'publication_plan_asset_snapshots',
                        'publication_plan_content_file_snapshots',
                        'publication_plan_ongoing_rules',
                        'publication_plan_measurement'
                    ]
                }
            }
        });
        const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
        const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
        const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
        const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
        const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;
        const ongoingRules = settings.find((setting) => setting.key === 'publication_plan_ongoing_rules')?.value;
        const measurement = settings.find((setting) => setting.key === 'publication_plan_measurement')?.value;
        if (!meta || !assets || !accounts) {
            return null;
        }
        return {
            meta: JSON.parse(meta),
            assets: JSON.parse(assets),
            accounts: JSON.parse(accounts),
            asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
            content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
            actions: [],
            ongoing_rules: ongoingRules ? JSON.parse(ongoingRules) : [],
            measurement: measurement ? JSON.parse(measurement) : {}
        };
    }
    resolvePlanRef(plan, ref) {
        if (!ref)
            return null;
        const parts = ref.split('.');
        let current = plan;
        for (const part of parts) {
            if (current == null)
                return null;
            current = current[part];
        }
        return current ?? null;
    }
    async getProjectGscChannel(projectId) {
        return prisma.socialChannel.findFirst({
            where: {
                project_id: projectId,
                type: 'google_search_console'
            }
        });
    }
    async evaluateBlockingConditions(task, plan) {
        const blockingConditions = (task.quality_report?.blocking_conditions || task.assets?.action?.blocking_conditions || []);
        if (blockingConditions.length === 0) {
            return { ready: true };
        }
        const dependencyTaskIds = (task.assets?.action?.dependencies || []);
        const dependencyItems = await this.findDependencyItems(task.project_id, dependencyTaskIds);
        const dependencyEntries = dependencyItems
            .map((item) => {
            const taskId = String(item.metrics?.task_id || '');
            return taskId ? [taskId, item] : null;
        })
            .filter((entry) => Boolean(entry));
        const dependencyByTaskId = new Map(dependencyEntries);
        for (const condition of blockingConditions) {
            if (condition.type === 'gsc_indexed') {
                const targetUrl = this.resolvePlanRef(plan, condition.url_ref);
                const gscChannel = await this.getProjectGscChannel(task.project_id);
                if (!targetUrl || !gscChannel) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'gsc_indexed', reason: 'Missing target URL or linked GSC channel.' }
                    };
                }
                const dependencyItem = dependencyTaskIds.map((taskId) => dependencyByTaskId.get(taskId)).find(Boolean);
                if (condition.min_days_indexed && dependencyItem) {
                    const ageMs = Date.now() - new Date(dependencyItem.updated_at).getTime();
                    const requiredMs = Number(condition.min_days_indexed) * 24 * 60 * 60 * 1000;
                    if (ageMs < requiredMs) {
                        return {
                            ready: false,
                            kind: 'waiting_on_blocking_condition',
                            details: { type: 'gsc_indexed', reason: `Minimum indexed age not reached (${condition.min_days_indexed}d).` }
                        };
                    }
                }
                const inspection = await gsc_service_1.default.inspectUrl(gscChannel.config.raw_account || gscChannel.config, targetUrl).catch(() => null);
                const coverageState = inspection?.inspectionResult?.indexStatusResult?.coverageState || inspection?.inspectionResult?.indexStatusResult?.verdict || '';
                if (!String(coverageState).toLowerCase().includes('indexed') && String(coverageState).toLowerCase() !== 'pass') {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'gsc_indexed', reason: `GSC has not confirmed indexation yet: ${coverageState || 'unknown'}` }
                    };
                }
            }
            if (condition.type === 'url_live') {
                const targetUrl = this.resolvePlanRef(plan, condition.url_ref);
                if (!targetUrl) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'url_live', reason: 'Missing target URL.' }
                    };
                }
                const response = await fetch(targetUrl, { method: 'GET' }).catch(() => null);
                if (!response?.ok) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'url_live', reason: `Target URL is not live yet: ${targetUrl}` }
                    };
                }
                const dependencyItem = dependencyTaskIds.map((taskId) => dependencyByTaskId.get(taskId)).find(Boolean);
                if (condition.min_days_live && dependencyItem) {
                    const ageMs = Date.now() - new Date(dependencyItem.updated_at).getTime();
                    const requiredMs = Number(condition.min_days_live) * 24 * 60 * 60 * 1000;
                    if (ageMs < requiredMs) {
                        return {
                            ready: false,
                            kind: 'waiting_on_blocking_condition',
                            details: { type: 'url_live', reason: `Minimum live age not reached (${condition.min_days_live}d).` }
                        };
                    }
                }
            }
            if (condition.type === 'ih_posting_privileges_granted') {
                const channelConfig = task.channel?.config || {};
                const granted = channelConfig.posting_privileges_granted === true
                    || channelConfig.privileges_granted === true
                    || channelConfig.can_post === true;
                if (!granted) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'ih_posting_privileges_granted', reason: 'Indie Hackers posting privileges have not been marked as granted.' }
                    };
                }
            }
        }
        return { ready: true };
    }
    async shouldReactivateDeferredTask(task, plan) {
        const trigger = task.quality_report?.reactivation_trigger || task.assets?.action?.reactivation_trigger || null;
        if (!trigger) {
            return { ready: false, reason: 'No reactivation trigger defined.' };
        }
        if (trigger === 'human_confirms_ih_posting_privileges_granted') {
            const channelConfig = task.channel?.config || {};
            const granted = channelConfig.posting_privileges_granted === true
                || channelConfig.privileges_granted === true
                || channelConfig.can_post === true;
            if (!granted) {
                return { ready: false, reason: 'Waiting for human confirmation of IH posting privileges.' };
            }
        }
        const blockingState = await this.evaluateBlockingConditions(task, plan);
        if (!blockingState.ready) {
            return { ready: false, reason: blockingState.details?.reason || 'Blocking conditions are not satisfied yet.' };
        }
        return { ready: true, reason: null };
    }
    async ensureRuleTask(projectId, rule, instanceKey, scheduleAt, extra = {}) {
        const existing = await prisma.contentItem.findFirst({
            where: {
                project_id: projectId,
                metrics: {
                    path: ['rule_instance_key'],
                    equals: instanceKey
                }
            }
        });
        if (existing) {
            return false;
        }
        await prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: null,
                type: `internal:${rule.action || rule.id}`,
                layer: 'internal',
                title: `Rule · ${rule.id}`,
                brief: `${rule.action || 'rule action'} triggered by ${rule.trigger}`,
                status: 'planned',
                schedule_at: scheduleAt,
                assets: {
                    source: 'ongoing_rule',
                    rule,
                    ...extra
                },
                quality_report: {
                    execution_mode: 'manual',
                    rule_id: rule.id,
                    trigger: rule.trigger
                },
                metrics: {
                    rule_id: rule.id,
                    rule_instance_key: instanceKey
                }
            }
        });
        return true;
    }
    async processPublicationOngoingRules() {
        let createdCount = 0;
        const ruleSettings = await prisma.projectSettings.findMany({
            where: { key: 'publication_plan_ongoing_rules' }
        });
        for (const ruleSetting of ruleSettings) {
            const projectId = ruleSetting.project_id;
            const plan = await this.loadPublicationPlanContext(projectId);
            if (!plan)
                continue;
            const timezone = plan.meta.timezone_default || 'UTC';
            const rules = Array.isArray(plan.ongoing_rules) ? plan.ongoing_rules : [];
            for (const rule of rules) {
                if (typeof rule?.trigger !== 'string' || !rule.id)
                    continue;
                const recurring = (0, publication_runtime_helpers_1.parseRecurringTrigger)(rule.trigger, timezone);
                if (recurring?.due) {
                    const instanceKey = `${rule.id}:${new Date().toISOString().slice(0, 10)}`;
                    const created = await this.ensureRuleTask(projectId, rule, instanceKey, recurring.scheduleAt);
                    if (created)
                        createdCount += 1;
                    continue;
                }
                if (rule.trigger.startsWith('after_action:')) {
                    const actionId = rule.trigger.replace('after_action:', '');
                    const sourceTask = await prisma.contentItem.findFirst({
                        where: {
                            project_id: projectId,
                            metrics: {
                                path: ['task_id'],
                                equals: actionId
                            },
                            status: 'published'
                        }
                    });
                    if (sourceTask) {
                        const instanceKey = `${rule.id}:${sourceTask.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceTask.updated_at, { source_task_id: sourceTask.id });
                        if (created)
                            createdCount += 1;
                    }
                    continue;
                }
                if (rule.trigger === 'after_any_linkedin_post' || rule.trigger === 'after_any_innokentiy_linkedin_post' || rule.trigger === 'after_any_publish_to_knowledge_section' || rule.trigger === 'after_any_article_publish_or_edit') {
                    const sourceItems = await prisma.contentItem.findMany({
                        where: {
                            project_id: projectId,
                            status: 'published'
                        },
                        include: { channel: true }
                    });
                    for (const sourceItem of sourceItems) {
                        const accountRef = sourceItem.metrics?.account_ref || '';
                        const publishedLink = sourceItem.published_link || '';
                        const isLinkedin = sourceItem.channel?.type === 'linkedin';
                        const isKnowledgePublish = publishedLink.includes('/knowledge/') || JSON.stringify(sourceItem.assets || {}).includes('knowledge');
                        const isArticlePublish = ['tilda:publish_article', 'tilda:publish_index_page', 'tilda:update_homepage'].includes(sourceItem.type);
                        const matches = (rule.trigger === 'after_any_linkedin_post' && isLinkedin) ||
                            (rule.trigger === 'after_any_innokentiy_linkedin_post' && isLinkedin && accountRef === 'innokentiy_linkedin') ||
                            (rule.trigger === 'after_any_publish_to_knowledge_section' && isKnowledgePublish) ||
                            (rule.trigger === 'after_any_article_publish_or_edit' && isArticlePublish);
                        if (!matches)
                            continue;
                        const instanceKey = `${rule.id}:${sourceItem.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceItem.updated_at, { source_task_id: sourceItem.id });
                        if (created)
                            createdCount += 1;
                    }
                }
            }
            const measurement = plan.measurement || {};
            const snapshotDays = Array.isArray(measurement.snapshot_days) ? measurement.snapshot_days : [];
            const cycleStart = plan.meta.cycle_start ? new Date(plan.meta.cycle_start) : null;
            if (cycleStart) {
                for (const snapshotDay of snapshotDays) {
                    const scheduleAt = new Date(cycleStart);
                    scheduleAt.setDate(scheduleAt.getDate() + Number(snapshotDay));
                    const instanceKey = `measurement:snapshot:${snapshotDay}`;
                    const created = await this.ensureRuleTask(projectId, {
                        id: `measurement-snapshot-${snapshotDay}`,
                        action: 'measurement_snapshot',
                        trigger: `day_${snapshotDay}`
                    }, instanceKey, scheduleAt, { measurement_snapshot_day: snapshotDay, measurement });
                    if (created)
                        createdCount += 1;
                }
            }
        }
        return createdCount;
    }
    async executeMeasurementSnapshot(task, plan) {
        const measurement = task.assets?.measurement || plan.measurement || {};
        const metricDefs = Array.isArray(measurement.metrics) ? measurement.metrics : [];
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        const results = {};
        for (const metricDef of metricDefs) {
            if (!metricDef?.id)
                continue;
            if (metricDef.source === 'gsc' && metricDef.url_ref && gscChannel) {
                const url = this.resolvePlanRef(plan, metricDef.url_ref);
                results[metricDef.id] = url
                    ? await gsc_service_1.default.queryPageMetrics(gscChannel.config.raw_account || gscChannel.config, url).catch((error) => ({ error: error.message }))
                    : { error: 'Missing URL reference' };
                continue;
            }
            if (metricDef.source === 'linkedin_analytics') {
                const linkedinTasks = await prisma.contentItem.findMany({
                    where: {
                        project_id: task.project_id,
                        status: 'published',
                        channel: { type: 'linkedin' }
                    },
                    include: { channel: true }
                });
                results[metricDef.id] = await Promise.all(linkedinTasks.map(async (item) => {
                    const config = item.channel?.config || {};
                    if (!config.linkedin_urn || !config.access_token || !item.published_link) {
                        return { task_id: item.metrics?.task_id || null, error: 'Missing LinkedIn credentials or link.' };
                    }
                    const metrics = await linkedin_service_1.default.getMetrics(config.linkedin_urn, config.access_token, item.published_link).catch((error) => ({ error: error.message }));
                    return {
                        task_id: item.metrics?.task_id || null,
                        title: item.title,
                        metrics
                    };
                }));
                continue;
            }
            if (metricDef.source === 'reddit') {
                const redditTasks = await prisma.contentItem.findMany({
                    where: {
                        project_id: task.project_id,
                        status: 'published',
                        channel: { type: 'reddit' }
                    }
                });
                results[metricDef.id] = await Promise.all(redditTasks.map(async (item) => ({
                    task_id: item.metrics?.task_id || null,
                    title: item.title,
                    metrics: item.published_link
                        ? await reddit_service_1.default.getPostMetrics(item.published_link).catch((error) => ({ error: error.message }))
                        : { error: 'Missing Reddit permalink.' }
                })));
                continue;
            }
            results[metricDef.id] = { unsupported: true, source: metricDef.source };
        }
        return results;
    }
    async executeGscHealthAudit(task, plan) {
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        if (!gscChannel) {
            return { error: 'No Google Search Console channel configured.' };
        }
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset) => asset?.target_url)
            .filter((url) => typeof url === 'string' && url.startsWith('https://'));
        const uniqueUrls = Array.from(new Set(candidateUrls));
        const inspections = await Promise.all(uniqueUrls.map(async (url) => ({
            url,
            inspection: await gsc_service_1.default.inspectUrl(gscChannel.config.raw_account || gscChannel.config, url).catch((error) => ({ error: error.message }))
        })));
        return {
            checked_urls: inspections.length,
            inspections
        };
    }
    async executeMediumCanonicalVerification(task, plan) {
        const sourceTaskId = task.assets?.source_task_id;
        const sourceTask = sourceTaskId
            ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } })
            : null;
        const mediumTask = sourceTask || await prisma.contentItem.findFirst({
            where: {
                project_id: task.project_id,
                type: 'medium:republish_with_canonical',
                status: 'published'
            },
            orderBy: { updated_at: 'desc' }
        });
        if (!mediumTask?.published_link) {
            return { error: 'No published Medium task found for canonical verification.' };
        }
        const response = await fetch(mediumTask.published_link).catch(() => null);
        if (!response?.ok) {
            return { error: `Unable to fetch Medium page: ${mediumTask.published_link}` };
        }
        const html = await response.text();
        const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
        const actualCanonical = canonicalMatch?.[1] || null;
        const expectedCanonical = this.resolvePlanRef(plan, 'assets.article_blog.target_url');
        return {
            medium_url: mediumTask.published_link,
            expected_canonical: expectedCanonical,
            actual_canonical: actualCanonical,
            valid: Boolean(actualCanonical && expectedCanonical && actualCanonical === expectedCanonical)
        };
    }
    async executeInternalLinkCrawl(task, plan) {
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset) => asset?.target_url)
            .filter((url) => typeof url === 'string' && url.startsWith('https://seturon.com'));
        const uniqueUrls = Array.from(new Set(candidateUrls));
        const results = await Promise.all(uniqueUrls.map(async (url) => {
            const response = await fetch(url).catch(() => null);
            if (!response?.ok) {
                return { url, ok: false, status: response?.status || null };
            }
            const html = await response.text();
            const internalLinks = Array.from(html.matchAll(/href=["'](https:\/\/seturon\.com[^"']+)["']/g)).map((match) => match[1]);
            return {
                url,
                ok: true,
                status: response.status,
                internal_link_count: internalLinks.length
            };
        }));
        return {
            checked_urls: results.length,
            results
        };
    }
    async markInternalTaskAsManual(task, reason) {
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'awaiting_manual_publication',
                quality_report: {
                    ...(task.quality_report || {}),
                    execution_result: {
                        mode: 'manual_required',
                        reason
                    },
                    prepared_at: new Date().toISOString()
                }
            }
        });
    }
    async createGeneratedPublicationTask(params) {
        return prisma.contentItem.create({
            data: {
                project_id: params.projectId,
                channel_id: params.channelId,
                type: params.type,
                layer: params.layer,
                title: params.title,
                brief: params.brief,
                draft_text: params.draftText || null,
                status: 'planned',
                schedule_at: params.scheduleAt || null,
                cross_link_to: params.sourceTaskId ? [params.sourceTaskId] : [],
                assets: {
                    source: 'ongoing_rule_generated',
                    action: params.action,
                    account_ref: params.accountRef || null,
                    asset_refs: params.assetRefs || [],
                    source_task_id: params.sourceTaskId || null
                },
                quality_report: {
                    execution_mode: 'manual',
                    generated_by_rule: true,
                    blocking_conditions: params.action?.blocking_conditions || [],
                    human_review: params.action?.human_review !== false,
                    human_review_reason: params.action?.human_review_reason || null,
                    display_name: params.action?.display_name || params.title
                },
                metrics: {
                    rule_generated: true,
                    task_id: params.action?.id || null,
                    task_display_name: params.action?.display_name || params.title,
                    account_ref: params.accountRef || null,
                    ...(params.extraMetrics || {})
                }
            }
        });
    }
    async executeBrandRepostRule(task, plan) {
        const sourceTaskId = task.assets?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask?.published_link) {
            return { skipped: true, reason: 'Source LinkedIn post is missing or not published yet.' };
        }
        const sourceAction = sourceTask.assets?.action || {};
        const sourceAssets = sourceTask.assets?.resolved_assets || [];
        const sourceAngle = sourceAssets.find((assetEntry) => assetEntry?.asset?.angle)?.asset?.angle || null;
        const exclusions = Array.isArray(task.assets?.rule?.exclusions) ? task.assets.rule.exclusions : [];
        if (exclusions.some((exclusion) => exclusion.angle === sourceAngle)) {
            return { skipped: true, reason: `Source angle \`${sourceAngle}\` is excluded from brand reposts.` };
        }
        const brandChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin',
                config: {
                    path: ['raw_account', 'type'],
                    equals: 'company_page'
                }
            }
        }) || await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin'
            }
        });
        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }
        const frameTemplate = task.assets?.rule?.repost_frame_template || 'From our founder: {one_or_two_sentence_relevance_for_creators}';
        const draftText = `${frameTemplate}\n\nSource post: ${sourceTask.published_link}`;
        const scheduledAt = new Date(sourceTask.updated_at.getTime() + 2 * 60 * 60 * 1000);
        const generatedActionId = `rule-repost-${sourceTask.id}`;
        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: brandChannel.id,
            type: 'linkedin:repost_with_frame',
            layer: 'linkedin',
            title: `LinkedIn Seturon page — Repost founder post: ${sourceTask.title || sourceAction.id || sourceTask.id}`,
            brief: 'Brand repost generated from founder post per ongoing rule.',
            scheduleAt: scheduledAt,
            draftText,
            sourceTaskId: sourceTask.id,
            accountRef: brandChannel.name,
            action: {
                id: generatedActionId,
                display_name: `LinkedIn Seturon page — Repost founder post`,
                channel: 'linkedin',
                action_type: 'repost_with_frame',
                account_ref: brandChannel.name,
                scheduled_date: scheduledAt.toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: task.assets?.rule?.human_review_reason || 'Approve brand frame before reposting.',
                parameters: {
                    repost_source_url: sourceTask.published_link,
                    frame_template: frameTemplate
                },
                asset_refs: []
            },
            extraMetrics: {
                rule_generated_from_source_task: sourceTask.id
            }
        });
        return {
            created_task_id: createdTask.id,
            source_task_id: sourceTask.id
        };
    }
    async executeBrandRotationRule(task, plan) {
        const rule = task.assets?.rule || {};
        const slots = Array.isArray(rule.rotation_slots_in_order) && rule.rotation_slots_in_order.length > 0
            ? rule.rotation_slots_in_order
            : ['A', 'B', 'C', 'D'];
        const stateKey = 'brand_rotation_current_slot';
        const storedState = await prisma.projectSettings.findUnique({
            where: {
                project_id_key: {
                    project_id: task.project_id,
                    key: stateKey
                }
            }
        });
        const currentSlot = storedState?.value || slots[0];
        const assetEntry = Object.entries(plan.assets || {}).find(([, asset]) => asset?.rotation_slot === currentSlot);
        if (!assetEntry) {
            return { skipped: true, reason: `No asset found for brand rotation slot ${currentSlot}.` };
        }
        const [assetRef, asset] = assetEntry;
        const brandChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin',
                config: {
                    path: ['raw_account', 'type'],
                    equals: 'company_page'
                }
            }
        }) || await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin'
            }
        });
        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }
        const existingGenerated = await prisma.contentItem.findFirst({
            where: {
                project_id: task.project_id,
                metrics: {
                    path: ['rule_generated_rotation_slot'],
                    equals: currentSlot
                },
                status: { in: ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'published'] }
            }
        });
        if (existingGenerated) {
            return { skipped: true, reason: `A task for rotation slot ${currentSlot} already exists.` };
        }
        const nextIndex = (slots.indexOf(currentSlot) + 1) % slots.length;
        const nextSlot = slots[nextIndex] || slots[0];
        const scheduleAt = task.schedule_at || new Date();
        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: brandChannel.id,
            type: 'linkedin:post_with_comment_link',
            layer: 'linkedin',
            title: `LinkedIn Seturon page — Rotation slot ${currentSlot}`,
            brief: `Brand page post draft prepared for rotation slot ${currentSlot}.`,
            scheduleAt,
            sourceTaskId: null,
            accountRef: brandChannel.name,
            assetRefs: [assetRef],
            action: {
                id: `rule-brand-slot-${currentSlot}-${scheduleAt.toISOString().slice(0, 10)}`,
                display_name: `LinkedIn Seturon page — Rotation slot ${currentSlot}`,
                channel: 'linkedin',
                action_type: 'post_with_comment_link',
                account_ref: brandChannel.name,
                scheduled_date: scheduleAt.toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: rule.human_review_reason || 'Approve brand-page post draft before publishing.',
                parameters: {
                    post_body_source: asset.section_marker || asset.path,
                    link_location: 'first_comment_only',
                    link_url_ref: asset.links_to ? `assets.${asset.links_to}.target_url` : null,
                    rotation_slot_used: currentSlot,
                    rotation_slot_next: nextSlot
                },
                asset_refs: [assetRef]
            },
            extraMetrics: {
                rule_generated_rotation_slot: currentSlot
            }
        });
        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: task.project_id,
                    key: stateKey
                }
            },
            update: { value: nextSlot },
            create: {
                project_id: task.project_id,
                key: stateKey,
                value: nextSlot
            }
        });
        return {
            created_task_id: createdTask.id,
            used_slot: currentSlot,
            next_slot: nextSlot
        };
    }
    async executeKnowledgeHubRule(task, plan) {
        const sourceTaskId = task.assets?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask) {
            return { skipped: true, reason: 'Source knowledge task not found.' };
        }
        const hubAsset = (plan.assets || {}).knowledge_hub_page;
        if (!hubAsset) {
            return { skipped: true, reason: 'knowledge_hub_page asset is missing from the plan.' };
        }
        const tildaChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'tilda'
            }
        });
        if (!tildaChannel) {
            return { skipped: true, reason: 'No Tilda channel is configured.' };
        }
        const sourceAction = sourceTask.assets?.action || {};
        const publishedUrl = sourceTask.published_link || this.resolvePlanRef(plan, sourceAction.asset_refs?.[0] ? `assets.${sourceAction.asset_refs[0]}.target_url` : null);
        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: tildaChannel.id,
            type: 'tilda:append_article_card_to_knowledge_hub',
            layer: 'tilda',
            title: `Tilda — Update knowledge hub after ${sourceTask.title || sourceTask.id}`,
            brief: 'Append the newly published knowledge article to the /knowledge/ hub page.',
            scheduleAt: new Date(),
            sourceTaskId: sourceTask.id,
            accountRef: tildaChannel.name,
            assetRefs: ['knowledge_hub_page'],
            action: {
                id: `rule-knowledge-hub-${sourceTask.id}`,
                display_name: `Tilda — Append article card to /knowledge/ hub`,
                channel: 'tilda',
                action_type: 'append_article_card_to_knowledge_hub',
                account_ref: tildaChannel.name,
                scheduled_date: new Date().toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: task.assets?.rule?.human_review_reason || 'Confirm category placement before updating the hub page.',
                parameters: {
                    target_asset_ref: 'knowledge_hub_page',
                    article_url: publishedUrl,
                    article_title: sourceTask.title
                },
                asset_refs: ['knowledge_hub_page']
            },
            extraMetrics: {
                rule_generated_from_source_task: sourceTask.id,
                target_url: hubAsset.target_url
            }
        });
        return {
            created_task_id: createdTask.id,
            source_task_id: sourceTask.id
        };
    }
    async processOperationalTasks() {
        let processedCount = 0;
        const tasks = await prisma.contentItem.findMany({
            where: {
                layer: 'internal',
                status: { in: ['planned', 'ready_for_execution'] },
                OR: [
                    { schedule_at: null },
                    { schedule_at: { lte: new Date() } }
                ]
            }
        });
        for (const task of tasks) {
            const plan = await this.loadPublicationPlanContext(task.project_id);
            if (!plan)
                continue;
            const rule = task.assets?.rule || {};
            const action = (rule.action || '').toString();
            let result = null;
            try {
                if (action === 'measurement_snapshot') {
                    result = await this.executeMeasurementSnapshot(task, plan);
                }
                else if (action === 'check_gsc_errors_on_published_urls') {
                    result = await this.executeGscHealthAudit(task, plan);
                }
                else if (action === 'verify_medium_canonical_via_gsc_url_inspection') {
                    result = await this.executeMediumCanonicalVerification(task, plan);
                }
                else if (action === 'crawl_internal_link_graph') {
                    result = await this.executeInternalLinkCrawl(task, plan);
                }
                else if (action === 'repost_with_brand_frame') {
                    result = await this.executeBrandRepostRule(task, plan);
                }
                else if (action === 'prepare_brand_page_post_for_current_rotation_slot') {
                    result = await this.executeBrandRotationRule(task, plan);
                }
                else if (action === 'append_article_card_to_knowledge_hub') {
                    result = await this.executeKnowledgeHubRule(task, plan);
                }
                else {
                    await this.markInternalTaskAsManual(task, `No automated executor is implemented for ongoing rule action \`${action}\`.`);
                    continue;
                }
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'published',
                        quality_report: {
                            ...(task.quality_report || {}),
                            execution_result: result,
                            executed_at: new Date().toISOString()
                        },
                        metrics: {
                            ...(task.metrics || {}),
                            execution_summary: result
                        }
                    }
                });
                processedCount += 1;
            }
            catch (error) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'failed',
                        quality_report: {
                            ...(task.quality_report || {}),
                            execution_error: error.message || String(error),
                            executed_at: new Date().toISOString()
                        }
                    }
                });
            }
        }
        return processedCount;
    }
    async processDeferredPublicationTasks() {
        let reactivatedCount = 0;
        const deferredTasks = await prisma.contentItem.findMany({
            where: {
                status: 'deferred',
                assets: { not: undefined }
            },
            include: {
                channel: true
            }
        });
        for (const task of deferredTasks) {
            const plan = await this.loadPublicationPlanContext(task.project_id);
            if (!plan)
                continue;
            const reactivation = await this.shouldReactivateDeferredTask(task, plan);
            if (!reactivation.ready) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        quality_report: {
                            ...(task.quality_report || {}),
                            last_reactivation_check_at: new Date().toISOString(),
                            reactivation_wait_reason: reactivation.reason
                        }
                    }
                });
                continue;
            }
            await prisma.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'planned',
                    quality_report: {
                        ...(task.quality_report || {}),
                        reactivated_at: new Date().toISOString(),
                        reactivation_wait_reason: null
                    }
                }
            });
            reactivatedCount += 1;
        }
        return reactivatedCount;
    }
    async processPublicationTasks() {
        const now = new Date();
        const dueTasks = await prisma.contentItem.findMany({
            where: {
                schedule_at: { lte: now },
                status: { in: ['planned', 'ready_for_execution'] },
                assets: { not: undefined }
            },
            include: { channel: true }
        });
        if (dueTasks.length === 0) {
            return 0;
        }
        for (const task of dueTasks) {
            try {
                await this.processPublicationTaskItem(task);
            }
            catch (error) {
                logToFile('ERROR', `[Publisher] Failed to process publication task ${task.id}`, error);
            }
        }
        return dueTasks.length;
    }
    async processPublicationTaskNow(taskId) {
        const task = await prisma.contentItem.findUnique({
            where: { id: taskId },
            include: { channel: true }
        });
        if (!task) {
            throw new Error(`Publication task ${taskId} not found`);
        }
        if (task.status === 'published') {
            throw new Error('This publication task is already published');
        }
        if (task.status === 'deferred' || task.status === 'skipped') {
            throw new Error(`This publication task cannot be executed from status '${task.status}'`);
        }
        return this.processPublicationTaskItem(task, { manualTrigger: true });
    }
    async processPublicationTaskItem(task, options = {}) {
        const dependencyState = await this.areTaskDependenciesSatisfied(task);
        if (!dependencyState.ready) {
            if (options.manualTrigger) {
                if (dependencyState.kind === 'waiting_on_deferred') {
                    throw new Error('Task is blocked by a deferred dependency');
                }
                if (dependencyState.kind === 'blocked_by_skipped') {
                    throw new Error('Task is blocked by a skipped dependency');
                }
                throw new Error('Task dependencies are not satisfied yet');
            }
            if (dependencyState.kind === 'waiting_on_deferred') {
                logToFile('INFO', `[Publisher] Task ${task.id} is parked because a dependency is deferred.`, dependencyState.details);
            }
            else if (dependencyState.kind === 'blocked_by_skipped') {
                logToFile('WARN', `[Publisher] Task ${task.id} is blocked because a dependency was skipped.`, dependencyState.details);
            }
            return { success: false, status: task.status, skipped: true };
        }
        const plan = await this.loadPublicationPlanContext(task.project_id);
        if (!plan) {
            throw new Error('No imported publication plan context is available for this task');
        }
        const blockingState = await this.evaluateBlockingConditions(task, plan);
        if (!blockingState.ready) {
            if (options.manualTrigger) {
                throw new Error('Task is waiting on blocking conditions');
            }
            logToFile('INFO', `[Publisher] Task ${task.id} is waiting on blocking conditions.`, blockingState.details);
            return { success: false, status: task.status, skipped: true };
        }
        const action = task.assets?.action;
        plan.actions = action ? [action] : [];
        const bundle = publication_plan_service_1.default.buildHandoffBundle(plan, task);
        const channelConfig = task.channel?.config || {};
        const executionMode = bundle.mode;
        if (executionMode === 'manual') {
            await prisma.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'awaiting_manual_publication',
                    quality_report: {
                        ...(task.quality_report || {}),
                        handoff_bundle: bundle,
                        prepared_at: new Date().toISOString()
                    }
                }
            });
            logToFile('INFO', `[Publisher] Prepared publication task ${task.id} (${bundle.task.action_type}) for manual execution.`);
            return {
                success: true,
                mode: 'manual',
                status: 'awaiting_manual_publication',
                adapter: task.channel?.type || task.layer || null,
                publishedLink: task.published_link || null
            };
        }
        const automatedResult = await this.executeAutomatedPublicationTask(task, bundle, channelConfig, plan);
        const nextStatus = automatedResult.manualFallback ? 'awaiting_manual_publication' : 'published';
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: nextStatus,
                published_link: automatedResult.publishedLink || task.published_link,
                quality_report: {
                    ...(task.quality_report || {}),
                    handoff_bundle: bundle,
                    execution_result: automatedResult,
                    prepared_at: new Date().toISOString()
                },
                metrics: {
                    ...(task.metrics || {}),
                    last_execution_at: new Date().toISOString(),
                    ...(automatedResult.metrics ? automatedResult.metrics : {})
                }
            }
        });
        logToFile('INFO', `[Publisher] Processed publication task ${task.id} (${bundle.task.action_type}) via automated adapter.`);
        return {
            success: true,
            mode: automatedResult.manualFallback ? 'manual' : 'automated',
            status: nextStatus,
            adapter: automatedResult.adapter || task.channel?.type || task.layer || null,
            publishedLink: automatedResult.publishedLink || task.published_link || null,
            manualFallback: automatedResult.manualFallback === true,
            reason: automatedResult.reason || null
        };
    }
    async areTaskDependenciesSatisfied(task) {
        const explicitActionDeps = (task.assets?.action?.dependencies || []);
        if (explicitActionDeps.length > 0) {
            const dependencyItems = await this.findDependencyItems(task.project_id, explicitActionDeps);
            const deferredDeps = dependencyItems.filter((item) => item.status === 'deferred');
            if (deferredDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting_on_deferred',
                    details: deferredDeps.map((item) => ({
                        id: item.id,
                        task_id: item.metrics?.task_id || null,
                        title: item.title
                    }))
                };
            }
            const skippedDeps = dependencyItems.filter((item) => item.status === 'skipped');
            if (skippedDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'blocked_by_skipped',
                    details: skippedDeps.map((item) => ({
                        id: item.id,
                        task_id: item.metrics?.task_id || null,
                        title: item.title
                    }))
                };
            }
            const publishedTaskIds = new Set(dependencyItems
                .filter((item) => item.status === 'published')
                .map((item) => item.metrics?.task_id)
                .filter(Boolean));
            const missingDeps = explicitActionDeps.filter((dep) => !publishedTaskIds.has(dep));
            if (missingDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting',
                    details: { missing_task_ids: missingDeps }
                };
            }
        }
        const linkedDeps = Array.isArray(task.cross_link_to) ? task.cross_link_to.filter((value) => typeof value === 'number') : [];
        if (linkedDeps.length > 0) {
            const linkedItems = await prisma.contentItem.findMany({
                where: {
                    id: { in: linkedDeps },
                    project_id: task.project_id,
                },
                select: {
                    id: true,
                    status: true,
                    title: true
                }
            });
            const deferredLinked = linkedItems.filter((item) => item.status === 'deferred');
            if (deferredLinked.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting_on_deferred',
                    details: deferredLinked
                };
            }
            const skippedLinked = linkedItems.filter((item) => item.status === 'skipped');
            if (skippedLinked.length > 0) {
                return {
                    ready: false,
                    kind: 'blocked_by_skipped',
                    details: skippedLinked
                };
            }
            const publishedLinkedIds = new Set(linkedItems.filter((item) => item.status === 'published').map((item) => item.id));
            const missingLinkedIds = linkedDeps.filter((depId) => !publishedLinkedIds.has(depId));
            if (missingLinkedIds.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting',
                    details: { missing_content_item_ids: missingLinkedIds }
                };
            }
        }
        return { ready: true };
    }
    async executeAutomatedPublicationTask(task, bundle, channelConfig, plan) {
        const channelType = task.channel?.type;
        const action = task.assets?.action || {};
        if (channelType === 'reddit') {
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title
                || action.parameters?.title
                || task.title
                || 'Reddit discussion';
            const subreddit = action.parameters?.subreddit || action.parameters?.sr || action.assets?.subreddit || task.layer;
            const text = bundle.publication?.body || '';
            const result = await reddit_service_1.default.submitDiscussionPost(channelConfig.raw_account || channelConfig, {
                subreddit,
                title,
                text
            });
            return {
                adapter: 'reddit',
                publishedLink: result.url,
                metrics: {
                    reddit_post_name: result.name || null
                }
            };
        }
        if (channelType === 'google_search_console') {
            const targetUrlRef = task.assets?.gsc_action?.url_ref || task.assets?.target_url_ref;
            const parentAction = task.assets?.parent_action_id
                ? plan.actions.find((item) => item.id === task.assets?.parent_action_id)
                : null;
            const resolvedTargetUrl = targetUrlRef ? this.resolvePlanRef(plan, targetUrlRef) : null;
            const fallbackLink = task.published_link || resolvedTargetUrl || parentAction?.parameters?.link_url_ref || null;
            const inspection = fallbackLink ? await gsc_service_1.default.inspectUrl(channelConfig.raw_account || channelConfig, fallbackLink) : null;
            const metrics = fallbackLink ? await gsc_service_1.default.queryPageMetrics(channelConfig.raw_account || channelConfig, fallbackLink) : null;
            return {
                adapter: 'gsc',
                publishedLink: fallbackLink,
                metrics: {
                    gsc_inspection: inspection,
                    gsc_page_metrics: metrics
                }
            };
        }
        if (channelType === 'tilda') {
            const result = await tilda_service_1.default.executePublish(channelConfig.raw_account || channelConfig, {
                task,
                bundle
            });
            if (result.mode === 'manual_required') {
                return {
                    adapter: 'tilda',
                    manualFallback: true,
                    reason: result.reason
                };
            }
            return {
                adapter: 'tilda',
                publishedLink: bundle.publication?.link_url || null,
                metrics: {
                    tilda_publish_response: result.response || null
                }
            };
        }
        return {
            adapter: 'unknown',
            manualFallback: true,
            reason: `No automated executor configured for channel type ${channelType}`
        };
    }
    async publishDuePosts() {
        const now = new Date();
        const duePosts = await prisma.post.findMany({
            where: {
                status: {
                    in: ['scheduled', 'scheduled_native']
                },
                publish_at: { lte: now }
            },
            include: {
                week: true
            }
        });
        if (duePosts.length === 0) {
            return 0;
        }
        logToFile('INFO', `[Publisher] Found ${duePosts.length} posts due (or past due) for publishing.`);
        // 🔒 LOCK POSTS immediately to prevent concurrent `setInterval` or `/jobs/publish-due` calls
        // from fetching and publishing the exact same posts simultaneously.
        await prisma.post.updateMany({
            where: { id: { in: duePosts.map(p => p.id) } },
            data: { status: 'publishing' }
        });
        for (const post of duePosts) {
            if (post.status === 'scheduled_native')
                continue;
            try {
                // Get the channel for this post
                let channel = null;
                if (post.channel_id) {
                    channel = await prisma.socialChannel.findUnique({
                        where: { id: post.channel_id }
                    });
                }
                // Fallback: Find first Telegram channel for project
                if (!channel) {
                    logToFile('INFO', `[Publisher] Post ${post.id} has no channel_id or channel not found. Trying default...`);
                    channel = await prisma.socialChannel.findFirst({
                        where: { project_id: post.project_id, type: 'telegram' }
                    });
                }
                if (!channel || !channel.config) {
                    logToFile('ERROR', `Channel not found or config missing for post ${post.id}`);
                    continue;
                }
                const text = post.final_text || post.generated_text || '';
                let sentMessageId;
                let publishedLink = null;
                let isPublishedViaClient = false;
                if (channel.type === 'vk') {
                    // VK Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to VK for post ${post.id}`);
                    const vkConfig = channel.config;
                    const vkId = vkConfig.vk_id;
                    const apiKey = vkConfig.api_key;
                    if (!vkId || !apiKey) {
                        logToFile('ERROR', `VK config missing id/key for post ${post.id}`);
                        continue;
                    }
                    try {
                        publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    }
                    catch (vkErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue; // Skip the rest if VK fails
                    }
                }
                else if (channel.type === 'linkedin') {
                    // LinkedIn Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to LinkedIn for post ${post.id}`);
                    const linkedinConfig = channel.config;
                    const urn = linkedinConfig.linkedin_urn;
                    const token = linkedinConfig.access_token;
                    if (!urn || !token) {
                        logToFile('ERROR', `LinkedIn config missing urn/token for post ${post.id}`);
                        continue;
                    }
                    try {
                        const importedLinkedin = require('./linkedin.service').default;
                        publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to LinkedIn: ${publishedLink}`);
                    }
                    catch (liErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to LinkedIn:`, liErr);
                        continue;
                    }
                }
                else if (channel.type === 'telegram') {
                    // Telegram Publishing Logic
                    const rawChannelId = channel.config.telegram_channel_id?.toString();
                    if (!rawChannelId) {
                        logToFile('ERROR', `Telegram channel config missing ID for post ${post.id}`);
                        continue;
                    }
                    // ⚠️ LOCAL DEV OVERRIDE: redirect all messages to the test channel
                    const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                    const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                        ? localTestChannel
                        : rawChannelId;
                    if (targetChannelId !== rawChannelId) {
                        logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${post.id} from ${rawChannelId} → ${targetChannelId}`);
                    }
                    // Try MTProto Client First
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        // Initialize (connect) if not already
                        await importedClient.init(post.project_id);
                        // We need to resolve image path here to pass string
                        let imagePathOrUrl;
                        if (post.image_url)
                            imagePathOrUrl = post.image_url;
                        console.log(`[Publisher] Calling MTProto publishPost for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                        console.log(`[Publisher] MTProto publishPost result for post ${post.id}:`, result ? `Success (ID: ${result.id})` : 'Falsy Result');
                        if (result) {
                            sentMessageId = result.id; // gramjs message object has .id
                            isPublishedViaClient = true;
                            console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                        else {
                            console.log(`[Publisher] MTProto publishPost returned falsy for post ${post.id}. Will fallback to Bot API!`);
                        }
                    }
                    catch (clientErr) {
                        if (clientErr.message && clientErr.message.includes('FLOOD_WAIT')) {
                            console.warn(`[Publisher] FLOOD_WAIT detected: ${clientErr.message}. Skipping this run for post ${post.id}.`);
                            // ⚠️ ROLLBACK status since we skipped it
                            await prisma.post.update({
                                where: { id: post.id },
                                data: { status: 'scheduled' }
                            });
                            continue;
                        }
                        console.warn(`[Publisher] MTProto Client failed (fallback to Bot API):`, clientErr.message || clientErr);
                    }
                    if (!isPublishedViaClient) {
                        // Fallback to Bot API Logic
                        console.log(`[Publisher] Falling back to Bot API for post ${post.id}`);
                        let sentMessage;
                        // ... (Existing Bot API Logic) ...
                        if (post.image_url) {
                            let photoSource = post.image_url;
                            if (post.image_url.startsWith('data:')) {
                                const base64Data = post.image_url.split(',')[1];
                                photoSource = { source: Buffer.from(base64Data, 'base64') };
                            }
                            else if (post.image_url.startsWith('/uploads/')) {
                                const fs = require('fs');
                                const path = require('path');
                                const filename = post.image_url.split('/').pop();
                                const localPath = path.join(__dirname, '../../uploads', filename);
                                if (fs.existsSync(localPath)) {
                                    photoSource = { source: fs.createReadStream(localPath) };
                                }
                                else {
                                    console.error(`Local image file not found: ${localPath}`);
                                    photoSource = null;
                                }
                            }
                            else {
                                // Assume it's a remote URL (Supabase or other)
                                photoSource = post.image_url;
                            }
                            if (photoSource) {
                                const CAPTION_LIMIT = 1024;
                                if (text.length > CAPTION_LIMIT) {
                                    if (typeof photoSource === 'string' && photoSource.startsWith('http')) {
                                        // HTTP URL: send as text with large media preview (no split, 1 message)
                                        sentMessage = await this.sendTextSplitting(targetChannelId, text, {
                                            link_preview_options: {
                                                url: photoSource,
                                                prefer_large_media: true,
                                                show_above_text: true,
                                                is_disabled: false
                                            }
                                        });
                                    }
                                    else {
                                        // Local file / Buffer: For Bot API, if it exceeds 1024, the only way to send
                                        // it as ONE message is to send the text with a hidden link preview to the image (if it's hosted).
                                        // Since it's a local file/buffer, we HAVE to send a photo. If it exceeds 1024, the Bot API WILL fail.
                                        // However, Telegram Premium bots can have 4096. We should just try sending it as a single caption first.
                                        // If it fails with "MEDIA_CAPTION_TOO_LONG", that's when we should split.
                                        // But to prevent the user from seeing "two messages", we should log it.
                                        // Actually, let's just attempt to send it as a single photo message first.
                                        try {
                                            sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                caption: text,
                                                parse_mode: 'Markdown'
                                            });
                                        }
                                        catch (sendErr) {
                                            if (sendErr.response?.body?.description?.includes('MEDIA_CAPTION_TOO_LONG')) {
                                                console.warn(`[Publisher] Caption too long for Bot API (${text.length} chars). Splitting into photo + reply.`);
                                                let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                                if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                    splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                                }
                                                if (splitIndex === -1)
                                                    splitIndex = CAPTION_LIMIT;
                                                const caption = text.substring(0, splitIndex);
                                                const remainder = text.substring(splitIndex).trim();
                                                const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                    caption: caption,
                                                    parse_mode: 'Markdown'
                                                });
                                                if (remainder.length > 0) {
                                                    sentMessage = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                                        parse_mode: 'Markdown',
                                                        reply_to_message_id: photoMsg?.message_id
                                                    });
                                                }
                                                else {
                                                    sentMessage = photoMsg;
                                                }
                                            }
                                            else {
                                                throw sendErr;
                                            }
                                        }
                                    }
                                }
                                else {
                                    sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                        caption: text,
                                        parse_mode: 'Markdown'
                                    });
                                }
                            }
                            else {
                                sentMessage = await this.sendTextSplitting(targetChannelId, text);
                            }
                        }
                        else {
                            sentMessage = await this.sendTextSplitting(targetChannelId, text);
                        }
                        sentMessageId = sentMessage?.message_id;
                    }
                    // Construct link
                    const channelUsername = channel.config.channel_username;
                    if (channelUsername) {
                        publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                    }
                    else if (targetChannelId.startsWith('-100')) {
                        const cleanId = targetChannelId.substring(4);
                        publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                    }
                    console.log(`[Publisher] Successfully published post ${post.id} to Telegram: ${targetChannelId}`);
                }
                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        status: 'published',
                        telegram_message_id: sentMessageId,
                        published_link: publishedLink
                    }
                });
                // Cleanup Image if it's from Supabase
                if (post.image_url && post.image_url.includes('supabase.co')) {
                    console.log(`[Publisher] Cleaning up Supabase image for post ${post.id}...`);
                    try {
                        await storage_service_1.default.deleteFile(post.image_url);
                    }
                    catch (cleanupErr) {
                        console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                    }
                }
                console.log(`[Publisher] Successfully published post ${post.id} to channel ${channel.name}`);
            }
            catch (err) {
                console.error(`[Publisher] Failed to publish post ${post.id}:`, err);
                // ⚠️ ROLLBACK status in case of an unexpected error
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'scheduled' }
                }).catch(e => console.error(`[Publisher] Failed to rollback status for post ${post.id}`, e));
            }
        }
        return duePosts.length;
    }
    /**
     * Checks whether the MTProto (GramJS) client can connect for a given project.
     * Returns true if the session is active and the connection was successful.
     */
    async checkMTProto(projectId) {
        try {
            const importedClient = require('./telegram_client.service').default;
            const success = await importedClient.init(projectId);
            if (success) {
                return { available: true };
            }
            return { available: false, reason: 'No active Telegram account session found for this project' };
        }
        catch (e) {
            return { available: false, reason: e.message || 'MTProto connection failed' };
        }
    }
    async publishPostNow(postId) {
        // 1. Fetch Post with Channel info
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { channel: true }
        });
        if (!post) {
            throw new Error(`Post ${postId} not found`);
        }
        const initialStatus = post.status;
        try {
            // 2. Get Channel info
            let channel = null;
            if (post.channel_id) {
                channel = await prisma.socialChannel.findUnique({ where: { id: post.channel_id } });
            }
            if (!channel) {
                channel = await prisma.socialChannel.findFirst({
                    where: { project_id: post.project_id, type: 'telegram' }
                });
            }
            if (!channel || !channel.config) {
                throw new Error(`Channel config not found for post ${postId}`);
            }
            // 🔒 LOCK POST to prevent concurrent running
            if (post.status === 'scheduled') {
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: 'publishing' }
                });
            }
            // 3. Send Immediately
            const text = post.final_text || post.generated_text || '';
            let sentMessageId;
            let publishedLink = null;
            let isPublishedViaClient = false;
            let publishWarning;
            if (channel.type === 'vk') {
                const vkConfig = channel.config;
                const vkId = vkConfig.vk_id;
                const apiKey = vkConfig.api_key;
                if (!vkId || !apiKey) {
                    throw new Error(`VK config missing id/key for post ${postId}`);
                }
                publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, text, post.image_url || undefined);
            }
            else if (channel.type === 'linkedin') {
                const linkedinConfig = channel.config;
                const urn = linkedinConfig.linkedin_urn;
                const token = linkedinConfig.access_token;
                if (!urn || !token) {
                    throw new Error(`LinkedIn config missing urn/token for post ${postId}`);
                }
                const importedLinkedin = require('./linkedin.service').default;
                publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
            }
            else if (channel.type === 'telegram') {
                const rawChannelId = channel.config.telegram_channel_id?.toString();
                if (!rawChannelId) {
                    throw new Error(`Telegram channel config missing ID for post ${postId}`);
                }
                // ⚠️ LOCAL DEV OVERRIDE: redirect all messages to the test channel
                const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                    ? localTestChannel
                    : rawChannelId;
                if (targetChannelId !== rawChannelId) {
                    logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${postId} from ${rawChannelId} → ${targetChannelId}`);
                }
                // --- Step 1: Check MTProto availability first ---
                const mtprotoCheck = await this.checkMTProto(post.project_id);
                if (!mtprotoCheck.available) {
                    publishWarning = `MTProto недоступен (${mtprotoCheck.reason}). Публикация через Bot API.`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }
                // --- Step 2: Try MTProto Client ---
                if (mtprotoCheck.available) {
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        let imagePathOrUrl;
                        if (post.image_url)
                            imagePathOrUrl = post.image_url;
                        logToFile('INFO', `[Publisher] publishPostNow: calling MTProto for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                        if (result) {
                            sentMessageId = result.id;
                            isPublishedViaClient = true;
                            logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                    }
                    catch (clientErr) {
                        publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                        logToFile('WARN', `[Publisher] ${publishWarning}`);
                    }
                }
                if (!isPublishedViaClient) {
                    // Fallback to Bot API Logic
                    let sentMessage;
                    if (post.image_url) {
                        let photoSource = post.image_url;
                        if (post.image_url.startsWith('data:')) {
                            const base64Data = post.image_url.split(',')[1];
                            photoSource = { source: Buffer.from(base64Data, 'base64') };
                        }
                        else if (post.image_url.startsWith('/uploads/')) {
                            const fs = require('fs');
                            const path = require('path');
                            const filename = post.image_url.split('/').pop();
                            const localPath = path.join(__dirname, '../../uploads', filename);
                            if (fs.existsSync(localPath)) {
                                photoSource = { source: fs.createReadStream(localPath) };
                            }
                            else {
                                console.error(`Local image file not found: ${localPath}`);
                                photoSource = null;
                            }
                        }
                        else {
                            // Remote URL
                            photoSource = post.image_url;
                        }
                        if (photoSource) {
                            const CAPTION_LIMIT = 1024;
                            if (text.length > CAPTION_LIMIT) {
                                if (typeof photoSource === 'string' && photoSource.startsWith('http')) {
                                    // Send as single text with large media preview instead of splitting
                                    sentMessage = await this.sendTextSplitting(targetChannelId, text, {
                                        link_preview_options: {
                                            url: photoSource,
                                            prefer_large_media: true,
                                            show_above_text: true,
                                            is_disabled: false
                                        }
                                    });
                                }
                                else {
                                    // Local file / Buffer: try sending as single photo (Premium users/bots have 4096 limit)
                                    try {
                                        sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                            caption: text,
                                            parse_mode: 'Markdown'
                                        });
                                    }
                                    catch (sendErr) {
                                        if (sendErr.response?.body?.description?.includes('MEDIA_CAPTION_TOO_LONG')) {
                                            console.warn(`[Publisher] Caption too long for Bot API (${text.length} chars). Splitting into photo + reply.`);
                                            let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                            if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                            }
                                            if (splitIndex === -1) {
                                                splitIndex = CAPTION_LIMIT;
                                            }
                                            const caption = text.substring(0, splitIndex);
                                            const remainder = text.substring(splitIndex).trim();
                                            const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                caption: caption,
                                                parse_mode: 'Markdown'
                                            });
                                            if (remainder.length > 0) {
                                                // Send overflow as reply to the photo — keeps visual unit intact
                                                sentMessage = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                                    parse_mode: 'Markdown',
                                                    reply_to_message_id: photoMsg?.message_id
                                                });
                                            }
                                            else {
                                                sentMessage = photoMsg;
                                            }
                                        }
                                        else {
                                            throw sendErr;
                                        }
                                    }
                                }
                            }
                            else {
                                sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                    caption: text,
                                    parse_mode: 'Markdown'
                                });
                            }
                        }
                        else {
                            sentMessage = await this.sendTextSplitting(targetChannelId, text);
                        }
                    }
                    else {
                        sentMessage = await this.sendTextSplitting(targetChannelId, text);
                    }
                    sentMessageId = sentMessage?.message_id;
                }
                // Construct link for Telegram
                const channelUsername = channel.config.channel_username;
                if (channelUsername) {
                    publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                }
                else if (targetChannelId.startsWith('-100')) {
                    const cleanId = targetChannelId.substring(4);
                    publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                }
            }
            // Update post status
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: 'published',
                    telegram_message_id: sentMessageId,
                    published_link: publishedLink
                }
            });
            // Cleanup Supabase image after publishing (non-blocking)
            if (post.image_url && post.image_url.includes('supabase.co')) {
                logToFile('INFO', `[Publisher] Cleaning up Supabase image for post ${postId}...`);
                storage_service_1.default.deleteFile(post.image_url).catch(err => logToFile('ERROR', `[Publisher] Failed to cleanup image:`, err));
            }
            return {
                success: true,
                publishMethod: isPublishedViaClient ? 'mtproto' : (channel.type === 'vk' ? 'vk' : (channel.type === 'linkedin' ? 'linkedin' : 'bot_api')),
                warning: publishWarning
            };
        }
        catch (error) {
            // Rollback if we locked it at 'publishing'
            if (initialStatus === 'scheduled') {
                logToFile('WARN', `[Publisher] publishPostNow failed, rolling back status to ${initialStatus} for post ${postId}`);
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: initialStatus }
                }).catch(e => logToFile('ERROR', 'Failed to rollback post status', e));
            }
            throw error;
        }
    }
    async scheduleNativePosts() {
        const now = new Date();
        const lookahead = new Date(now.getTime() + 5 * 60 * 1000); // Posts due in > 5m
        // Find posts that are 'scheduled' but far enough in the future
        const futurePosts = await prisma.post.findMany({
            where: {
                status: 'scheduled',
                publish_at: { gt: lookahead }
            },
            include: {
                project: {
                    include: {
                        settings: true,
                        channels: true
                    }
                }
            }
        });
        if (futurePosts.length > 0) {
            logToFile('INFO', `[Publisher] Checking ${futurePosts.length} future posts for native scheduling...`);
        }
        for (const post of futurePosts) {
            // Check if Native Scheduling is enabled for this project
            const settings = post.project.settings;
            const nativeEnabled = settings.find(s => s.key === 'telegram_native_scheduling')?.value === 'true';
            if (!nativeEnabled)
                continue;
            // Find Channel
            let channel = null;
            if (post.channel_id) {
                channel = post.project.channels.find(c => c.id === post.channel_id);
            }
            else {
                // Fallback default
                channel = post.project.channels.find(c => c.type === 'telegram');
            }
            if (!channel || channel.type !== 'telegram' || !channel.config.telegram_channel_id) {
                continue;
            }
            const targetChannelId = channel.config.telegram_channel_id.toString();
            const text = post.final_text || post.generated_text || '';
            // Try MTProto Client
            try {
                const importedClient = require('./telegram_client.service').default;
                await importedClient.init(post.project_id);
                let imagePathOrUrl;
                if (post.image_url)
                    imagePathOrUrl = post.image_url;
                // Pass schedule param (UNIX timestamp or Date object depending on library, gramjs takes Date or int)
                // Note: telegram_client.service.ts publishPost signature needs update or we pass it in options?
                // The current publishPost signature is: (projectId, target, text, imageUrl)
                // We need to update TelegramClientService.publishPost to accept 'scheduleDate'.
                // Let's first update TelegramClientService, then come back here? 
                // Or I can update TelegramClientService.publishPost to take an options object.
                // Current signature: publishPost(projectId: number, target: string | number, text: string, imageUrl?: string | null)
                // I will assume I update TelegramClientService to accept a 5th arg 'scheduleDate'.
                const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, post.publish_at);
                if (result) {
                    logToFile('INFO', `[Publisher] Scheduled natively via MTProto: Message ID ${result.id}`);
                    // Update Status
                    await prisma.post.update({
                        where: { id: post.id },
                        data: {
                            status: 'scheduled_native',
                            telegram_message_id: result.id
                        }
                    });
                }
            }
            catch (err) {
                logToFile('ERROR', `[Publisher] Failed to natively schedule post ${post.id}:`, err);
            }
        }
    }
    async sendTextSplitting(chatId, text, extraOptions = {}) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            return await telegram_service_1.default.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...extraOptions
            });
        }
        else {
            // Split logic
            const chunks = [];
            let remaining = text;
            while (remaining.length > 0) {
                let chunk = remaining.substring(0, MAX_LENGTH);
                // Try to cut at newline
                const lastNewline = chunk.lastIndexOf('\n');
                if (lastNewline > MAX_LENGTH * 0.8) {
                    chunk = remaining.substring(0, lastNewline);
                }
                chunks.push(chunk);
                remaining = remaining.substring(chunk.length);
            }
            let lastMessage;
            let isFirst = true;
            for (const chunk of chunks) {
                lastMessage = await telegram_service_1.default.sendMessage(chatId, chunk, {
                    parse_mode: 'Markdown',
                    ...(isFirst ? extraOptions : {})
                });
                isFirst = false;
            }
            return lastMessage;
        }
    }
}
exports.default = new PublisherService();
