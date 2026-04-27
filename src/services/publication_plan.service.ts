import * as fs from 'fs';
import * as path from 'path';
import prisma from '../db';
import publicationAdapterService from './publication_adapter.service';

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
};

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

    const parts = ref.split('.');
    let current: any = plan;
    for (const part of parts) {
        if (current == null) return null;
        current = current[part];
    }
    return current ?? null;
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

class PublicationPlanService {
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

            if (existingProject) {
                await tx.contentItem.deleteMany({ where: { project_id: project.id } });
                await tx.weekPackage.deleteMany({ where: { project_id: project.id } });

                const existingChannels = await tx.socialChannel.findMany({
                    where: { project_id: project.id }
                });
                const adapterChannelIds = existingChannels
                    .filter((channel) => (channel.config as any)?.adapter_kind === 'publication_source')
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

            const accountActions = Object.entries(plan.accounts).reduce<Record<string, any[]>>((acc, [accountRef]) => {
                acc[accountRef] = plan.actions.filter((action) => action.account_ref === accountRef);
                return acc;
            }, {});

            const channels = await Promise.all(
                Object.entries(plan.accounts).map(async ([accountRef, account]) => {
                    return tx.socialChannel.create({
                        data: {
                            project_id: project.id,
                            type: account.platform,
                            name: accountRef,
                            config: publicationAdapterService.buildAdapterConfig(accountRef, account, accountActions[accountRef])
                        }
                    });
                })
            );

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
                    narrative_arc: plan.meta as any,
                    channel_mix: Object.fromEntries(Object.entries(plan.accounts).map(([key, value]) => [key, (value as any).platform])) as any,
                    approval_status: 'approved'
                }
            });

            for (const action of plan.actions) {
                const schedule = computeSchedule(action, plan.meta.timezone_default);
                const resolvedAssets = (action.asset_refs || []).map((ref: string) => ({
                    ref,
                    asset: plan.assets[ref] || null
                }));
                const account = plan.accounts[action.account_ref] || {};
                const executionMode = publicationAdapterService.inferExecutionMode(account, action);

                const createdItem = await tx.contentItem.create({
                    data: {
                        project_id: project.id,
                        week_package_id: weekPackage.id,
                        channel_id: channelMap.get(action.account_ref) || null,
                        type: `${action.channel}:${action.action_type}`,
                        layer: action.channel,
                        title: `${action.id} · ${action.action_type}`,
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
                        } as any,
                        metrics: {
                            publication_plan_id: plan.meta.plan_id,
                            task_id: action.id,
                            timezone: schedule?.timezone || plan.meta.timezone_default || null,
                            account_ref: action.account_ref,
                            monitoring: publicationAdapterService.deriveMonitoringPlan(action)
                        } as any,
                        published_link: action.status === 'completed' ? action.verification?.find((item: any) => item.type === 'post_live_check')?.url || null : null
                    }
                });

                const gscPostActions = (action.post_actions || []).filter((item: any) =>
                    item.type === 'submit_to_gsc' || item.type === 'gsc_url_inspection'
                );

                for (const postAction of gscPostActions) {
                    if (!gscChannel) continue;

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
                            } as any,
                            quality_report: {
                                execution_mode: 'automated',
                                verification: [],
                                post_actions: []
                            } as any,
                            metrics: {
                                publication_plan_id: plan.meta.plan_id,
                                task_id: `${action.id}:${postAction.type}`,
                                account_ref: gscChannel.name,
                                monitoring: {
                                    needs_analytics_collection: true
                                }
                            } as any
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

    buildHandoffBundle(plan: PublicationPlan, item: any) {
        const action = item.assets?.action || {};
        const accountRef = item.assets?.account_ref || null;
        const account = accountRef ? plan.accounts[accountRef] : null;
        const pipelineRoot = plan.meta.pipeline_root || '';
        const assetRefs = item.assets?.asset_refs || [];
        const resolvedAssets = assetRefs.map((ref: string) => {
            const asset = plan.assets[ref];
            if (!asset) {
                return { ref, missing: true };
            }

            const fullPath = asset.path ? path.join(pipelineRoot, asset.path) : null;
            let content: string | null = null;
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

        const primaryTextAsset = resolvedAssets.find((entry: any) => typeof entry.content === 'string' && entry.content.trim());
        const linkUrl = resolveRef(plan, action.parameters?.link_url_ref || item.cta || null);

        return {
            mode: publicationAdapterService.inferExecutionMode(account || {}, action),
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
                html_bundle: resolvedAssets.filter((entry: any) => entry.asset?.type?.includes('html')),
                link_url: linkUrl,
                visuals: resolvedAssets.filter((entry: any) => entry.asset?.visual_style || entry.asset?.gamma_source)
            },
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
