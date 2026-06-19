import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import prisma from '../db';
import publicationAdapterService from './publication_adapter.service';
import { mapActionStatus, resolveActionTitle } from './publication_runtime.helpers';

type PublicationPlan = {
    meta: {
        plan_id: string;
        plan_version?: string;
        generated_at?: string;
        source_article_id?: string;
        cycle_start?: string;
        cycle_end?: string;
        timezone_default?: string;
        owner?: string;
        pipeline_root?: string;
    };
    accounts: Record<string, any>;
    assets: Record<string, any>;
    actions: Array<any>;
    ongoing_rules?: Array<any>;
    measurement?: any;
    dependencies_matrix_visualized?: Record<string, any>;
    asset_snapshots?: Record<string, any>;
};

type AssetSnapshot = {
    ref: string;
    relative_path: string | null;
    file_name: string | null;
    section_marker: string | null;
    content: string | null;
    content_type: string | null;
    content_length: number;
    checksum: string | null;
    source: 'filesystem' | 'inline' | 'mcp' | 'preserved';
    source_available: boolean;
    captured_at: string;
};

const RUNTIME_LOCKED_TASK_STATUSES = new Set([
    'drafted',
    'revised',
    'approved',
    'scheduled',
    'ready_for_execution',
    'awaiting_manual_publication',
    'published'
]);

function slugify(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

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

function resolveRef(plan: PublicationPlan, ref?: string | null): any {
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

function dedupeResourceFiles(entries: any[]) {
    const seen = new Set<string>();
    return entries.filter((entry) => {
        const key = [
            entry.relative_path || '',
            entry.url || '',
            entry.section_marker || ''
        ].join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function inferContentType(relativePath?: string | null) {
    if (!relativePath) return 'text/plain';
    const normalized = relativePath.toLowerCase();
    if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'text/markdown';
    if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'text/html';
    if (normalized.endsWith('.json')) return 'application/json';
    if (normalized.endsWith('.yaml') || normalized.endsWith('.yml')) return 'application/yaml';
    return 'text/plain';
}

function checksumContent(content: string | null) {
    if (typeof content !== 'string') return null;
    return createHash('sha256').update(content).digest('hex');
}

function computeSchedule(action: any, fallbackTimezone?: string) {
    if (!action.scheduled_date) return null;

    const start = action.scheduled_time_window?.start || '09:00';
    const timezone = action.scheduled_time_window?.timezone || fallbackTimezone || 'UTC';

    return {
        scheduled_at: new Date(`${action.scheduled_date}T${start}:00`),
        timezone
    };
}

function derivePublicationOutcome(action: any): string | null {
    if (action?.status !== 'completed_with_negative_outcome') {
        return null;
    }

    const result = String(action?.outcome?.result || '').toLowerCase();
    if (result.includes('ban') || result.includes('block')) return 'blocked';
    if (result.includes('remove')) return 'removed';
    if (result.includes('restrict')) return 'restricted';
    return 'blocked';
}

function getImportedTaskId(item: any) {
    const taskId = (item?.metrics as any)?.task_id;
    return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null;
}

function isExternalPublicationPlanItem(item: any) {
    return (item?.assets as any)?.source === 'external_publication_plan' && Boolean(getImportedTaskId(item));
}

function shouldPreserveRuntimeTask(item: any) {
    return RUNTIME_LOCKED_TASK_STATUSES.has(String(item?.status || ''));
}

class PublicationPlanService {
    getPublicationPlanFormat() {
        return {
            version: '2026-06-publication-plan-v2',
            summary: 'Preferred planner publication-plan format for MCP and chat-generated plans.',
            top_level: {
                required: ['meta', 'accounts', 'assets', 'actions'],
                optional: ['ongoing_rules', 'measurement', 'dependencies_matrix_visualized']
            },
            meta: {
                required: ['plan_id'],
                optional: [
                    'plan_version',
                    'generated_at',
                    'source_article_id',
                    'cycle_start',
                    'cycle_end',
                    'timezone_default',
                    'owner',
                    'pipeline_root',
                    'project_name',
                    'description'
                ]
            },
            accounts: {
                shape: 'Record<string, account>',
                required_fields: ['platform'],
                examples: [
                    { ref: 'spherical_analyst_tg', platform: 'telegram' },
                    { ref: 'seturon_linkedin', platform: 'linkedin' }
                ]
            },
            assets: {
                shape: 'Record<string, asset>',
                supported_patterns: [
                    {
                        kind: 'inline_preview',
                        when_to_use: 'Short preview, teaser, or compact raw note that can be rendered directly in UI.',
                        fields: ['type', 'content']
                    },
                    {
                        kind: 'file_backed_content',
                        when_to_use: 'Full draft or source material stored in a markdown/html file.',
                        fields: ['type', 'path', 'section_marker?']
                    },
                    {
                        kind: 'url_asset',
                        when_to_use: 'Canonical URL, destination page, image source, or external reference.',
                        fields: ['type', 'target_url']
                    }
                ]
            },
            actions: {
                shape: 'Array<action>',
                required_fields: ['id', 'channel', 'account_ref', 'action_type'],
                strongly_recommended_fields: ['display_name'],
                preferred_content_pattern: {
                    rule: 'For full publication text, use action.content_files. Do not rely on free-text hints inside asset.content.',
                    content_files_item: {
                        required: ['role'],
                        recommended: ['purpose'],
                        one_of: [
                            ['path'],
                            ['url'],
                            ['url_ref']
                        ],
                        optional: ['section_marker']
                    }
                }
            },
            recommendations: [
                'Use asset.content only for compact inline text or preview notes.',
                'Use action.content_files for the full publication body, markdown sections, or HTML fragments.',
                'Use unique section_marker values that match stable headings in the source file.',
                'If a post depends on a full markdown section, make that dependency explicit in content_files.'
            ]
        };
    }

    getPublicationPlanTemplate(input: {
        planId?: string;
        projectName?: string;
        owner?: string;
        timezone?: string;
        channelRef?: string;
        channelPlatform?: string;
    } = {}) {
        const planId = input.planId || 'project-cycle-2026-06';
        const channelRef = input.channelRef || 'primary_channel';
        const channelPlatform = input.channelPlatform || 'telegram';
        const timezone = input.timezone || 'Europe/Lisbon';

        return {
            meta: {
                plan_id: planId,
                plan_version: '1.0.0',
                generated_at: new Date().toISOString(),
                cycle_start: '2026-06-01',
                cycle_end: '2026-06-30',
                timezone_default: timezone,
                owner: input.owner || 'workspace_owner',
                project_name: input.projectName || 'Новый проект',
                description: 'План публикаций, подготовленный через MCP/чат.'
            },
            accounts: {
                [channelRef]: {
                    platform: channelPlatform
                }
            },
            assets: {
                teaser_note_1: {
                    type: `${channelPlatform}_inline_preview`,
                    content: 'Краткая идея или превью материала для быстрых карточек в UI.'
                },
                article_source_1: {
                    type: 'markdown_source',
                    path: 'weeks/w01.md',
                    section_marker: 'Idea 1 — «Название секции»'
                },
                target_article_url: {
                    type: 'canonical_url',
                    target_url: 'https://example.com/article'
                }
            },
            actions: [
                {
                    id: 'a-w01-001',
                    display_name: `${channelPlatform} — публикация 1`,
                    channel: channelPlatform,
                    account_ref: channelRef,
                    action_type: 'post_text',
                    status: 'planned',
                    scheduled_date: '2026-06-03',
                    scheduled_time_window: {
                        start: '10:00',
                        end: '10:00',
                        timezone
                    },
                    asset_refs: ['teaser_note_1'],
                    content_files: [
                        {
                            role: 'post_body',
                            purpose: 'Полный текст публикации',
                            path: 'weeks/w01.md',
                            section_marker: 'Idea 1 — «Название секции»'
                        }
                    ],
                    parameters: {
                        link_url_ref: 'assets.target_article_url.target_url'
                    },
                    notes: 'Краткий комментарий по задаче.'
                }
            ],
            ongoing_rules: [],
            measurement: {}
        };
    }

    normalizePublicationPlan(raw: string) {
        const parsed = this.parsePlan(raw);
        const warnings: string[] = [];

        const normalized = {
            ...parsed,
            ongoing_rules: Array.isArray(parsed.ongoing_rules) ? parsed.ongoing_rules : [],
            measurement: parsed.measurement || {},
            actions: parsed.actions.map((action: any) => {
                const normalizedAction = {
                    ...action,
                    asset_refs: Array.isArray(action.asset_refs) ? action.asset_refs : [],
                    content_files: Array.isArray(action.content_files)
                        ? action.content_files
                            .filter(Boolean)
                            .map((entry: any) => ({
                                role: entry.role || 'post_body',
                                purpose: entry.purpose || null,
                                path: entry.path || null,
                                url: entry.url || null,
                                url_ref: entry.url_ref || null,
                                section_marker: entry.section_marker || null
                            }))
                        : []
                };

                if (!normalizedAction.display_name) {
                    warnings.push(`Action '${action.id}' is missing display_name.`);
                }

                if (normalizedAction.content_files.length === 0 && normalizedAction.asset_refs.length > 0) {
                    const inlineOnlyRefs = normalizedAction.asset_refs.filter((ref: string) => {
                        const asset = parsed.assets?.[ref];
                        return asset && typeof asset.content === 'string' && !asset.path;
                    });

                    if (inlineOnlyRefs.length > 0) {
                        warnings.push(
                            `Action '${action.id}' relies on inline asset content (${inlineOnlyRefs.join(', ')}). Add content_files for full text if this should render a complete draft.`
                        );
                    }
                }

                normalizedAction.content_files.forEach((entry: any, index: number) => {
                    if (!entry.path && !entry.url && !entry.url_ref) {
                        warnings.push(`Action '${action.id}' content_files[${index}] should define path, url, or url_ref.`);
                    }
                    if (entry.path && !entry.section_marker) {
                        warnings.push(`Action '${action.id}' content_files[${index}] uses a path without section_marker. This is valid, but section_marker is recommended for multi-section files.`);
                    }
                });

                return normalizedAction;
            })
        };

        return {
            normalizedPlan: normalized,
            warnings,
            format: this.getPublicationPlanFormat()
        };
    }

    parsePlan(raw: string): PublicationPlan {
        const parsed = JSON.parse(raw);
        if (!parsed?.meta?.plan_id || !parsed?.accounts || !parsed?.assets || !Array.isArray(parsed?.actions)) {
            throw new Error('Invalid publication plan: expected meta.plan_id, accounts, assets, actions[]');
        }
        return parsed as PublicationPlan;
    }

    loadPlanFromPath(planPath: string): PublicationPlan {
        const raw = fs.readFileSync(planPath, 'utf8');
        return this.parsePlan(raw);
    }

    async importPlan(params: { rawPlan?: string; planPath?: string; userId: number }) {
        const plan = params.rawPlan
            ? this.parsePlan(params.rawPlan)
            : this.loadPlanFromPath(params.planPath || '');

        const existingPlanMarker = await prisma.projectSettings.findFirst({
            where: {
                key: 'publication_plan_id',
                value: plan.meta.plan_id
            }
        });

        const existingProject = existingPlanMarker
            ? await prisma.project.findUnique({ where: { id: existingPlanMarker.project_id } })
            : null;

        let slug = existingProject?.slug || '';
        if (!existingProject) {
            const baseSlug = slugify(plan.meta.plan_id) || `publication-plan-${Date.now()}`;
            slug = baseSlug;
            let suffix = 1;
            while (await prisma.project.findUnique({ where: { slug } })) {
                slug = `${baseSlug}-${suffix}`;
                suffix += 1;
            }
        }

        const existingSnapshots = existingProject
            ? await this.loadAssetSnapshots(existingProject.id)
            : {};
        const assetSnapshots = this.buildAssetSnapshots(plan, existingSnapshots);

        return prisma.$transaction(async (tx) => {
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

            const existingChannels = await tx.socialChannel.findMany({
                where: { project_id: project.id }
            });

            const existingImportedItems = (await tx.contentItem.findMany({
                where: { project_id: project.id }
            })).filter(isExternalPublicationPlanItem);

            const existingImportedItemsByTaskId = new Map(
                existingImportedItems
                    .map((item) => [getImportedTaskId(item) as string, item] as const)
            );

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
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_asset_snapshots',
                    value: JSON.stringify(assetSnapshots)
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_ongoing_rules',
                    value: JSON.stringify(plan.ongoing_rules || [])
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_measurement',
                    value: JSON.stringify(plan.measurement || {})
                },
                {
                    project_id: project.id,
                    key: 'publication_plan_dependencies_matrix',
                    value: JSON.stringify(plan.dependencies_matrix_visualized || {})
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

            const accountActions = Object.entries(plan.accounts).reduce<Record<string, any[]>>((acc, [accountRef]) => {
                acc[accountRef] = plan.actions.filter((action) => action.account_ref === accountRef);
                return acc;
            }, {});

            const channels = await Promise.all(
                Object.entries(plan.accounts).map(async ([accountRef, account]) => {
                    const channelConfig = publicationAdapterService.buildAdapterConfig(accountRef, account, accountActions[accountRef]);
                    const existingChannel = existingChannels.find((channel) => channel.name === accountRef);

                    if (existingChannel) {
                        return tx.socialChannel.update({
                            where: { id: existingChannel.id },
                            data: {
                                type: account.platform,
                                config: channelConfig,
                                is_active: true
                            }
                        });
                    }

                    return tx.socialChannel.create({
                        data: {
                            project_id: project.id,
                            type: account.platform,
                            name: accountRef,
                            config: channelConfig
                        }
                    });
                })
            );

            const channelMap = new Map(channels.map((channel) => [channel.name, channel.id]));
            const gscChannel = channels.find((channel) => channel.type === 'google_search_console') || null;

            const cycleStart = plan.meta.cycle_start ? new Date(plan.meta.cycle_start) : new Date();
            const cycleEnd = plan.meta.cycle_end ? new Date(plan.meta.cycle_end) : new Date(cycleStart);

            const existingWeekPackage = await tx.weekPackage.findFirst({
                where: { project_id: project.id },
                orderBy: { id: 'asc' }
            });

            const weekPackageData = {
                project_id: project.id,
                week_start: cycleStart,
                week_end: cycleEnd,
                week_theme: `Publication cycle ${plan.meta.plan_id}`,
                core_thesis: plan.meta.source_article_id || null,
                audience_focus: 'external_strategy',
                intent_tag: 'distribution_execution',
                narrative_arc: plan.meta as any,
                channel_mix: Object.fromEntries(Object.entries(plan.accounts).map(([key, value]) => [key, (value as any).platform])) as any,
                approval_status: 'approved'
            };

            const weekPackage = existingWeekPackage
                ? await tx.weekPackage.update({
                    where: { id: existingWeekPackage.id },
                    data: weekPackageData
                })
                : await tx.weekPackage.create({
                    data: weekPackageData
                });

            const importedTaskIds = new Set<string>();

            for (const action of plan.actions) {
                const schedule = computeSchedule(action, plan.meta.timezone_default);
                const resolvedAssets = (action.asset_refs || []).map((ref: string) => ({
                    ref,
                    asset: plan.assets[ref] || null
                }));
                const account = plan.accounts[action.account_ref] || {};
                const executionMode = publicationAdapterService.inferExecutionMode(account, action);
                const mappedStatus = mapActionStatus(action.status);
                const publicationOutcome = derivePublicationOutcome(action);
                const taskId = String(action.id);
                importedTaskIds.add(taskId);

                const itemData = {
                    project_id: project.id,
                    week_package_id: weekPackage.id,
                    channel_id: channelMap.get(action.account_ref) || null,
                    type: `${action.channel}:${action.action_type}`,
                    layer: action.channel,
                    title: resolveActionTitle(action),
                    brief: action.notes || action.human_review_reason || null,
                    key_points: resolvedAssets as any,
                    cta: action.parameters?.link_url_ref || null,
                    cross_link_to: action.dependencies || [],
                    assets: {
                        source: 'external_publication_plan',
                        action,
                        account_ref: action.account_ref,
                        asset_refs: action.asset_refs || [],
                        resolved_assets: resolvedAssets
                    } as any,
                    status: mappedStatus,
                    schedule_at: schedule?.scheduled_at || null,
                    quality_report: {
                        execution_mode: executionMode,
                        verification: action.verification || [],
                        post_actions: action.post_actions || [],
                        human_review: action.human_review === true,
                        human_review_reason: action.human_review_reason || null,
                        blocking_conditions: action.blocking_conditions || [],
                        display_name: action.display_name || null,
                        deferred_reason: action.deferred_reason || null,
                        blocked_by: action.blocked_by || [],
                        reactivation_trigger: action.reactivation_trigger || null,
                        target_cycle_after_unblock: action.target_cycle_after_unblock || null,
                        publication_outcome: publicationOutcome,
                        plan_outcome: action.outcome || null,
                        skip_reason: action.skip_reason || null
                    } as any,
                    metrics: {
                        publication_plan_id: plan.meta.plan_id,
                        task_id: taskId,
                        task_display_name: action.display_name || null,
                        timezone: schedule?.timezone || plan.meta.timezone_default || null,
                        account_ref: action.account_ref,
                        publication_outcome: publicationOutcome,
                        monitoring: publicationAdapterService.deriveMonitoringPlan(action)
                    } as any,
                    published_link: action.status === 'completed'
                        ? action.verification?.find((item: any) => item.type === 'post_live_check')?.url || null
                        : null
                };

                const existingItem = existingImportedItemsByTaskId.get(taskId);

                const createdItem = existingItem
                    ? shouldPreserveRuntimeTask(existingItem)
                        ? existingItem
                        : await tx.contentItem.update({
                            where: { id: existingItem.id },
                            data: {
                                ...itemData,
                                assets: {
                                    ...((existingItem.assets as any) || {}),
                                    ...itemData.assets
                                } as any,
                                quality_report: {
                                    ...((existingItem.quality_report as any) || {}),
                                    ...itemData.quality_report
                                } as any,
                                metrics: {
                                    ...((existingItem.metrics as any) || {}),
                                    ...itemData.metrics
                                } as any,
                                published_link: existingItem.published_link || itemData.published_link
                            }
                        })
                    : await tx.contentItem.create({
                        data: itemData
                    });

                const gscPostActions = (action.post_actions || []).filter((item: any) =>
                    item.type === 'submit_to_gsc' || item.type === 'gsc_url_inspection'
                );

                for (const postAction of gscPostActions) {
                    if (!gscChannel) continue;

                    const followupTaskId = `${action.id}:${postAction.type}`;
                    importedTaskIds.add(followupTaskId);

                    const followupData = {
                        project_id: project.id,
                        week_package_id: weekPackage.id,
                        channel_id: gscChannel.id,
                        type: `google_search_console:${postAction.type}`,
                        layer: 'google_search_console',
                        title: `${resolveActionTitle(action)} · ${postAction.type}`,
                        brief: `Follow-up GSC action for ${action.id}`,
                        cross_link_to: [createdItem.id],
                        status: mappedStatus === 'deferred' ? 'deferred' : mappedStatus === 'skipped' ? 'skipped' : 'planned',
                        schedule_at: schedule?.scheduled_at || null,
                        assets: {
                            source: 'external_publication_plan',
                            parent_action_id: action.id,
                            parent_content_item_id: createdItem.id,
                            gsc_action: postAction,
                            target_url_ref: postAction.url_ref || action.parameters?.link_url_ref || null
                        } as any,
                        quality_report: {
                            execution_mode: 'automated',
                            verification: [],
                            post_actions: []
                        } as any,
                        metrics: {
                            publication_plan_id: plan.meta.plan_id,
                            task_id: followupTaskId,
                            task_display_name: action.display_name ? `${action.display_name} · ${postAction.type}` : null,
                            account_ref: gscChannel.name,
                            monitoring: {
                                needs_analytics_collection: true
                            }
                        } as any
                    };

                    const existingFollowup = existingImportedItemsByTaskId.get(followupTaskId);

                    if (existingFollowup) {
                        if (shouldPreserveRuntimeTask(existingFollowup)) {
                            continue;
                        }

                        await tx.contentItem.update({
                            where: { id: existingFollowup.id },
                            data: {
                                ...followupData,
                                assets: {
                                    ...((existingFollowup.assets as any) || {}),
                                    ...followupData.assets
                                } as any,
                                quality_report: {
                                    ...((existingFollowup.quality_report as any) || {}),
                                    ...followupData.quality_report
                                } as any,
                                metrics: {
                                    ...((existingFollowup.metrics as any) || {}),
                                    ...followupData.metrics
                                } as any,
                                published_link: existingFollowup.published_link || null
                            }
                        });
                        continue;
                    }

                    await tx.contentItem.create({
                        data: followupData
                    });
                }
            }

            const staleImportedIds = existingImportedItems
                .filter((item) => {
                    const taskId = getImportedTaskId(item);
                    if (!taskId || importedTaskIds.has(taskId)) {
                        return false;
                    }
                    return !shouldPreserveRuntimeTask(item);
                })
                .map((item) => item.id);

            if (staleImportedIds.length > 0) {
                await tx.contentItem.deleteMany({
                    where: {
                        id: { in: staleImportedIds }
                    }
                });
            }

            return {
                project,
                imported: {
                    accounts: channels.length,
                    actions: plan.actions.length,
                    assets: Object.keys(plan.assets).length,
                    assetSnapshots: Object.keys(assetSnapshots).length,
                    ongoingRules: (plan.ongoing_rules || []).length,
                    updatedExistingProject: Boolean(existingProject)
                }
            };
        });
    }

    private readAssetContent(plan: PublicationPlan, asset: any, relativePath: string) {
        const pipelineRoot = plan.meta.pipeline_root || '';
        if (!pipelineRoot) {
            return null;
        }

        const fullPath = path.resolve(pipelineRoot, relativePath);
        const normalizedRoot = path.resolve(pipelineRoot);
        if (!fullPath.startsWith(normalizedRoot)) {
            return null;
        }

        if (!fs.existsSync(fullPath)) {
            return null;
        }

        const rawContent = fs.readFileSync(fullPath, 'utf8');
        return {
            fullPath,
            content: asset.section_marker ? resolveSection(rawContent, asset.section_marker) : rawContent
        };
    }

    buildAssetSnapshots(plan: PublicationPlan, existingSnapshots: Record<string, AssetSnapshot> = {}, overrides: Record<string, Partial<AssetSnapshot> & { content?: string | null }> = {}) {
        const snapshots: Record<string, AssetSnapshot> = {};

        for (const [ref, asset] of Object.entries(plan.assets || {})) {
            const relativePath = typeof (asset as any)?.path === 'string' ? (asset as any).path : null;
            const sectionMarker = (asset as any)?.section_marker || null;
            const previous = existingSnapshots[ref];
            const override = overrides[ref];

            if (override && typeof override.content === 'string') {
                snapshots[ref] = {
                    ref,
                    relative_path: relativePath,
                    file_name: relativePath ? path.basename(relativePath) : null,
                    section_marker: sectionMarker,
                    content: override.content,
                    content_type: override.content_type || inferContentType(relativePath),
                    content_length: override.content.length,
                    checksum: checksumContent(override.content),
                    source: 'mcp',
                    source_available: true,
                    captured_at: new Date().toISOString()
                };
                continue;
            }

            const inlineContent = typeof (asset as any)?.content === 'string' ? (asset as any).content : null;
            if (inlineContent) {
                snapshots[ref] = {
                    ref,
                    relative_path: relativePath,
                    file_name: relativePath ? path.basename(relativePath) : ref,
                    section_marker: sectionMarker,
                    content: inlineContent,
                    content_type: inferContentType(relativePath),
                    content_length: inlineContent.length,
                    checksum: checksumContent(inlineContent),
                    source: 'inline',
                    source_available: true,
                    captured_at: new Date().toISOString()
                };
                continue;
            }

            if (!relativePath) {
                continue;
            }

            const resolved = this.readAssetContent(plan, asset, relativePath);
            if (resolved) {
                snapshots[ref] = {
                    ref,
                    relative_path: relativePath,
                    file_name: path.basename(relativePath),
                    section_marker: sectionMarker,
                    content: resolved.content,
                    content_type: inferContentType(relativePath),
                    content_length: resolved.content.length,
                    checksum: checksumContent(resolved.content),
                    source: 'filesystem',
                    source_available: true,
                    captured_at: new Date().toISOString()
                };
                continue;
            }

            if (previous?.content) {
                snapshots[ref] = {
                    ...previous,
                    ref,
                    relative_path: relativePath,
                    file_name: path.basename(relativePath),
                    section_marker: sectionMarker,
                    source: previous.source === 'mcp' ? 'mcp' : 'preserved',
                    source_available: false
                };
            }
        }

        return snapshots;
    }

    resolveAssetRuntime(plan: PublicationPlan, assetRef: string, maxChars?: number) {
        const asset = plan.assets?.[assetRef];
        if (!asset) {
            return {
                ref: assetRef,
                missing: true
            };
        }

        const relativePath = typeof asset.path === 'string' ? asset.path : null;
        const snapshot = plan.asset_snapshots?.[assetRef] || null;
        const runtimeRead = relativePath ? this.readAssetContent(plan, asset, relativePath) : null;
        const inlineContent = typeof asset.content === 'string' ? asset.content : null;
        const snapshotContent = typeof snapshot?.content === 'string' ? snapshot.content : null;
        const content = runtimeRead?.content ?? inlineContent ?? snapshotContent;
        const truncated = typeof maxChars === 'number' && typeof content === 'string' && content.length > maxChars;

        return {
            ref: assetRef,
            asset,
            full_path: runtimeRead?.fullPath || (relativePath && plan.meta.pipeline_root ? path.resolve(plan.meta.pipeline_root, relativePath) : null),
            file_name: relativePath ? path.basename(relativePath) : (inlineContent ? assetRef : null),
            relative_path: relativePath,
            section_marker: asset.section_marker || null,
            exists: Boolean(content),
            content: typeof content === 'string'
                ? (truncated ? `${content.slice(0, maxChars)}\n...[truncated]` : content)
                : null,
            truncated: Boolean(truncated),
            snapshot_available: Boolean(snapshotContent),
            content_source: runtimeRead?.content ? 'filesystem' : (inlineContent ? 'inline' : (snapshotContent ? (snapshot?.source || 'snapshot') : null)),
            snapshot
        };
    }

    async loadAssetSnapshots(projectId: number) {
        const snapshots = await prisma.projectSettings.findFirst({
            where: {
                project_id: projectId,
                key: 'publication_plan_asset_snapshots'
            }
        });

        if (!snapshots?.value) {
            return {};
        }

        try {
            return JSON.parse(snapshots.value);
        } catch {
            return {};
        }
    }

    async saveAssetSnapshots(projectId: number, snapshots: Record<string, AssetSnapshot>) {
        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: 'publication_plan_asset_snapshots'
                }
            },
            update: {
                value: JSON.stringify(snapshots)
            },
            create: {
                project_id: projectId,
                key: 'publication_plan_asset_snapshots',
                value: JSON.stringify(snapshots)
            }
        });

        return snapshots;
    }

    async refreshAssetSnapshots(projectId: number, plan: PublicationPlan, overrides: Record<string, Partial<AssetSnapshot> & { content?: string | null }> = {}) {
        const existing = await this.loadAssetSnapshots(projectId);
        const snapshots = this.buildAssetSnapshots(plan, existing, overrides);
        await this.saveAssetSnapshots(projectId, snapshots);
        return snapshots;
    }

    buildHandoffBundle(plan: PublicationPlan, item: any) {
        const action = item.assets?.action || {};
        const accountRef = item.assets?.account_ref || null;
        const account = accountRef ? plan.accounts[accountRef] : null;
        const assetRefs = item.assets?.asset_refs || [];
        const resolvedAssets = assetRefs.map((ref: string) => this.resolveAssetRuntime(plan, ref));
        const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
        const resolvedContentFiles = contentFiles.map((file: any, index: number) => {
            const relativePath = file.path || null;
            const resolvedUrl = file.url_ref ? resolveRef(plan, file.url_ref) : file.url || null;
            let content: string | null = null;
            let exists = false;
            let fullPath: string | null = null;

            if (relativePath) {
                const syntheticAsset = {
                    path: relativePath,
                    section_marker: file.section_marker || null
                };
                const resolved = this.readAssetContent(plan, syntheticAsset, relativePath);
                fullPath = resolved?.fullPath || (plan.meta.pipeline_root ? path.resolve(plan.meta.pipeline_root, relativePath) : null);
                if (resolved?.content) {
                    exists = true;
                    content = resolved.content;
                }
            }

            return {
                ref: `content_file_${index + 1}`,
                type: 'content_file',
                role: file.role || null,
                purpose: file.purpose || null,
                file_name: relativePath ? path.basename(relativePath) : null,
                relative_path: relativePath,
                full_path: fullPath,
                section_marker: file.section_marker || null,
                exists,
                url: resolvedUrl,
                content
            };
        });

        const primaryTextAsset = [...resolvedContentFiles, ...resolvedAssets].find((entry: any) => typeof entry.content === 'string' && entry.content.trim());
        const linkUrl = resolveRef(plan, action.parameters?.link_url_ref || item.cta || null);

        const resourceFiles = dedupeResourceFiles([
            ...resolvedContentFiles,
            ...resolvedAssets.map((entry: any) => ({
                ref: entry.ref,
                type: entry.asset?.type || null,
                role: null,
                purpose: null,
                file_name: entry.file_name || null,
                relative_path: entry.relative_path || null,
                full_path: entry.full_path || null,
                section_marker: entry.section_marker || null,
                exists: entry.exists === true,
                url: null,
                content: entry.content || null
            }))
        ]);

        return {
            mode: publicationAdapterService.inferExecutionMode(account || {}, action),
            account: {
                ref: accountRef,
                details: account
            },
            task: {
                id: action.id || item.id,
                display_name: action.display_name || item.title || null,
                channel: action.channel || item.layer,
                action_type: action.action_type || item.type,
                scheduled_date: action.scheduled_date || item.schedule_at,
                time_window: action.scheduled_time_window || null
            },
            publication: {
                body: primaryTextAsset?.content || item.draft_text || '',
                html_bundle: resolvedAssets.filter((entry: any) => entry.asset?.type?.includes('html')),
                link_url: linkUrl,
                visuals: resolvedAssets.filter((entry: any) => entry.asset?.visual_style || entry.asset?.gamma_source)
            },
            resource_files: resourceFiles,
            manual_checklist: publicationAdapterService.buildManualChecklist(action, {
                linkUrl,
                accountRef
            }),
            verification: action.verification || [],
            post_actions: action.post_actions || [],
            dependencies: action.dependencies || []
        };
    }
}

export default new PublicationPlanService();
