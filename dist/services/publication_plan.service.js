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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const db_1 = __importDefault(require("../db"));
const publication_adapter_service_1 = __importDefault(require("./publication_adapter.service"));
function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
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
function resolveRef(plan, ref) {
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
function computeSchedule(action, fallbackTimezone) {
    if (!action.scheduled_date)
        return null;
    const start = action.scheduled_time_window?.start || '09:00';
    const timezone = action.scheduled_time_window?.timezone || fallbackTimezone || 'UTC';
    return {
        scheduled_at: new Date(`${action.scheduled_date}T${start}:00`),
        timezone
    };
}
class PublicationPlanService {
    parsePlan(raw) {
        const parsed = JSON.parse(raw);
        if (!parsed?.meta?.plan_id || !parsed?.accounts || !parsed?.assets || !Array.isArray(parsed?.actions)) {
            throw new Error('Invalid publication plan: expected meta.plan_id, accounts, assets, actions[]');
        }
        return parsed;
    }
    loadPlanFromPath(planPath) {
        const raw = fs.readFileSync(planPath, 'utf8');
        return this.parsePlan(raw);
    }
    async importPlan(params) {
        const plan = params.rawPlan
            ? this.parsePlan(params.rawPlan)
            : this.loadPlanFromPath(params.planPath || '');
        const existingPlanMarker = await db_1.default.projectSettings.findFirst({
            where: {
                key: 'publication_plan_id',
                value: plan.meta.plan_id
            }
        });
        const existingProject = existingPlanMarker
            ? await db_1.default.project.findUnique({ where: { id: existingPlanMarker.project_id } })
            : null;
        let slug = existingProject?.slug || '';
        if (!existingProject) {
            const baseSlug = slugify(plan.meta.plan_id) || `publication-plan-${Date.now()}`;
            slug = baseSlug;
            let suffix = 1;
            while (await db_1.default.project.findUnique({ where: { slug } })) {
                slug = `${baseSlug}-${suffix}`;
                suffix += 1;
            }
        }
        return db_1.default.$transaction(async (tx) => {
            const project = existingProject
                ? await tx.project.update({
                    where: { id: existingProject.id },
                    data: {
                        name: plan.meta.plan_id,
                        description: `Imported publication plan ${plan.meta.plan_id}`
                    }
                })
                : await tx.project.create({
                    data: {
                        name: plan.meta.plan_id,
                        slug,
                        description: `Imported publication plan ${plan.meta.plan_id}`,
                        members: {
                            create: {
                                user_id: params.userId,
                                role: 'owner'
                            }
                        }
                    }
                });
            if (existingProject) {
                await tx.contentItem.deleteMany({ where: { project_id: project.id } });
                await tx.weekPackage.deleteMany({ where: { project_id: project.id } });
                const existingChannels = await tx.socialChannel.findMany({
                    where: { project_id: project.id }
                });
                const adapterChannelIds = existingChannels
                    .filter((channel) => channel.config?.adapter_kind === 'publication_source')
                    .map((channel) => channel.id);
                if (adapterChannelIds.length > 0) {
                    await tx.socialChannel.deleteMany({ where: { id: { in: adapterChannelIds } } });
                }
            }
            const settingsPayload = [
                {
                    project_id: project.id,
                    key: 'publication_plan_id',
                    value: plan.meta.plan_id
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_meta',
                    value: JSON.stringify(plan.meta)
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_assets',
                    value: JSON.stringify(plan.assets)
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_accounts',
                    value: JSON.stringify(plan.accounts)
                }
            ];
            for (const setting of settingsPayload) {
                await tx.projectSettings.upsert({
                    where: {
                        project_id_key: {
                            project_id: project.id,
                            key: setting.key
                        }
                    },
                    update: { value: setting.value },
                    create: setting
                });
            }
            const accountActions = Object.entries(plan.accounts).reduce((acc, [accountRef]) => {
                acc[accountRef] = plan.actions.filter((action) => action.account_ref === accountRef);
                return acc;
            }, {});
            const channels = await Promise.all(Object.entries(plan.accounts).map(async ([accountRef, account]) => {
                return tx.socialChannel.create({
                    data: {
                        project_id: project.id,
                        type: account.platform,
                        name: accountRef,
                        config: publication_adapter_service_1.default.buildAdapterConfig(accountRef, account, accountActions[accountRef])
                    }
                });
            }));
            const channelMap = new Map(channels.map((channel) => [channel.name, channel.id]));
            const gscChannel = channels.find((channel) => channel.type === 'google_search_console') || null;
            const cycleStart = plan.meta.cycle_start ? new Date(plan.meta.cycle_start) : new Date();
            const cycleEnd = plan.meta.cycle_end ? new Date(plan.meta.cycle_end) : new Date(cycleStart);
            const weekPackage = await tx.weekPackage.create({
                data: {
                    project_id: project.id,
                    week_start: cycleStart,
                    week_end: cycleEnd,
                    week_theme: `Publication cycle ${plan.meta.plan_id}`,
                    core_thesis: plan.meta.source_article_id || null,
                    audience_focus: 'external_strategy',
                    intent_tag: 'distribution_execution',
                    narrative_arc: plan.meta,
                    channel_mix: Object.fromEntries(Object.entries(plan.accounts).map(([key, value]) => [key, value.platform])),
                    approval_status: 'approved'
                }
            });
            for (const action of plan.actions) {
                const schedule = computeSchedule(action, plan.meta.timezone_default);
                const resolvedAssets = (action.asset_refs || []).map((ref) => ({
                    ref,
                    asset: plan.assets[ref] || null
                }));
                const account = plan.accounts[action.account_ref] || {};
                const executionMode = publication_adapter_service_1.default.inferExecutionMode(account, action);
                const createdItem = await tx.contentItem.create({
                    data: {
                        project_id: project.id,
                        week_package_id: weekPackage.id,
                        channel_id: channelMap.get(action.account_ref) || null,
                        type: `${action.channel}:${action.action_type}`,
                        layer: action.channel,
                        title: `${action.id} · ${action.action_type}`,
                        brief: action.notes || action.human_review_reason || null,
                        key_points: resolvedAssets,
                        cta: action.parameters?.link_url_ref || null,
                        cross_link_to: action.dependencies || [],
                        assets: {
                            source: 'external_publication_plan',
                            action,
                            account_ref: action.account_ref,
                            asset_refs: action.asset_refs || [],
                            resolved_assets: resolvedAssets
                        },
                        status: action.status === 'completed'
                            ? 'published'
                            : action.status === 'skipped'
                                ? 'skipped'
                                : 'planned',
                        schedule_at: schedule?.scheduled_at || null,
                        quality_report: {
                            execution_mode: executionMode,
                            verification: action.verification || [],
                            post_actions: action.post_actions || [],
                            human_review: action.human_review === true,
                            human_review_reason: action.human_review_reason || null,
                            blocking_conditions: action.blocking_conditions || []
                        },
                        metrics: {
                            publication_plan_id: plan.meta.plan_id,
                            task_id: action.id,
                            timezone: schedule?.timezone || plan.meta.timezone_default || null,
                            account_ref: action.account_ref,
                            monitoring: publication_adapter_service_1.default.deriveMonitoringPlan(action)
                        },
                        published_link: action.status === 'completed' ? action.verification?.find((item) => item.type === 'post_live_check')?.url || null : null
                    }
                });
                const gscPostActions = (action.post_actions || []).filter((item) => item.type === 'submit_to_gsc' || item.type === 'gsc_url_inspection');
                for (const postAction of gscPostActions) {
                    if (!gscChannel)
                        continue;
                    await tx.contentItem.create({
                        data: {
                            project_id: project.id,
                            week_package_id: weekPackage.id,
                            channel_id: gscChannel.id,
                            type: `google_search_console:${postAction.type}`,
                            layer: 'google_search_console',
                            title: `${action.id} · ${postAction.type}`,
                            brief: `Follow-up GSC action for ${action.id}`,
                            cross_link_to: [createdItem.id],
                            status: 'planned',
                            schedule_at: schedule?.scheduled_at || null,
                            assets: {
                                source: 'external_publication_plan',
                                parent_action_id: action.id,
                                parent_content_item_id: createdItem.id,
                                gsc_action: postAction,
                                target_url_ref: postAction.url_ref || action.parameters?.link_url_ref || null
                            },
                            quality_report: {
                                execution_mode: 'automated',
                                verification: [],
                                post_actions: []
                            },
                            metrics: {
                                publication_plan_id: plan.meta.plan_id,
                                task_id: `${action.id}:${postAction.type}`,
                                account_ref: gscChannel.name,
                                monitoring: {
                                    needs_analytics_collection: true
                                }
                            }
                        }
                    });
                }
            }
            return {
                project,
                imported: {
                    accounts: channels.length,
                    actions: plan.actions.length,
                    assets: Object.keys(plan.assets).length,
                    updatedExistingProject: Boolean(existingProject)
                }
            };
        });
    }
    buildHandoffBundle(plan, item) {
        const action = item.assets?.action || {};
        const accountRef = item.assets?.account_ref || null;
        const account = accountRef ? plan.accounts[accountRef] : null;
        const pipelineRoot = plan.meta.pipeline_root || '';
        const assetRefs = item.assets?.asset_refs || [];
        const resolvedAssets = assetRefs.map((ref) => {
            const asset = plan.assets[ref];
            if (!asset) {
                return { ref, missing: true };
            }
            const fullPath = asset.path ? path.join(pipelineRoot, asset.path) : null;
            let content = null;
            if (fullPath && fs.existsSync(fullPath)) {
                const rawContent = fs.readFileSync(fullPath, 'utf8');
                content = asset.section_marker ? resolveSection(rawContent, asset.section_marker) : rawContent;
            }
            return {
                ref,
                asset,
                full_path: fullPath,
                content
            };
        });
        const primaryTextAsset = resolvedAssets.find((entry) => typeof entry.content === 'string' && entry.content.trim());
        const linkUrl = resolveRef(plan, action.parameters?.link_url_ref || item.cta || null);
        return {
            mode: publication_adapter_service_1.default.inferExecutionMode(account || {}, action),
            account: {
                ref: accountRef,
                details: account
            },
            task: {
                id: action.id || item.id,
                channel: action.channel || item.layer,
                action_type: action.action_type || item.type,
                scheduled_date: action.scheduled_date || item.schedule_at,
                time_window: action.scheduled_time_window || null
            },
            publication: {
                body: primaryTextAsset?.content || item.draft_text || '',
                html_bundle: resolvedAssets.filter((entry) => entry.asset?.type?.includes('html')),
                link_url: linkUrl,
                visuals: resolvedAssets.filter((entry) => entry.asset?.visual_style || entry.asset?.gamma_source)
            },
            manual_checklist: publication_adapter_service_1.default.buildManualChecklist(action, {
                linkUrl,
                accountRef
            }),
            verification: action.verification || [],
            post_actions: action.post_actions || [],
            dependencies: action.dependencies || []
        };
    }
}
exports.default = new PublicationPlanService();
