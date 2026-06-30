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
const crypto_1 = require("crypto");
const db_1 = __importDefault(require("../db"));
const publication_adapter_service_1 = __importDefault(require("./publication_adapter.service"));
const publication_runtime_helpers_1 = require("./publication_runtime.helpers");
const content_dictionary_service_1 = __importDefault(require("./content_dictionary.service"));
const RUNTIME_LOCKED_TASK_STATUSES = new Set([
    'drafted',
    'revised',
    'approved',
    'scheduled',
    'ready_for_execution',
    'awaiting_manual_publication',
    'published'
]);
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
function dedupeResourceFiles(entries) {
    const seen = new Set();
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
function inferContentType(relativePath) {
    if (!relativePath)
        return 'text/plain';
    const normalized = relativePath.toLowerCase();
    if (normalized.endsWith('.md') || normalized.endsWith('.markdown'))
        return 'text/markdown';
    if (normalized.endsWith('.html') || normalized.endsWith('.htm'))
        return 'text/html';
    if (normalized.endsWith('.json'))
        return 'application/json';
    if (normalized.endsWith('.yaml') || normalized.endsWith('.yml'))
        return 'application/yaml';
    return 'text/plain';
}
function checksumContent(content) {
    if (typeof content !== 'string')
        return null;
    return (0, crypto_1.createHash)('sha256').update(content).digest('hex');
}
function computeSchedule(action, fallbackTimezone) {
    if (action.scheduled_at) {
        const parsed = new Date(action.scheduled_at);
        if (!Number.isNaN(parsed.getTime())) {
            return {
                scheduled_at: parsed,
                timezone: fallbackTimezone || action.scheduled_time_window?.timezone || 'UTC'
            };
        }
    }
    if (!action.scheduled_date)
        return null;
    const start = action.scheduled_time_window?.start || '09:00';
    const timezone = action.scheduled_time_window?.timezone || fallbackTimezone || 'UTC';
    return {
        scheduled_at: new Date(`${action.scheduled_date}T${start}:00`),
        timezone
    };
}
function derivePublicationOutcome(action) {
    if (action?.status !== 'completed_with_negative_outcome') {
        return null;
    }
    const result = String(action?.outcome?.result || '').toLowerCase();
    if (result.includes('ban') || result.includes('block'))
        return 'blocked';
    if (result.includes('remove'))
        return 'removed';
    if (result.includes('restrict'))
        return 'restricted';
    return 'blocked';
}
function getImportedTaskId(item) {
    const taskId = item?.metrics?.task_id;
    return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null;
}
function isExternalPublicationPlanItem(item) {
    return item?.assets?.source === 'external_publication_plan' && Boolean(getImportedTaskId(item));
}
function shouldPreserveRuntimeTask(item) {
    return RUNTIME_LOCKED_TASK_STATUSES.has(String(item?.status || ''));
}
function contentFileSnapshotKey(relativePath, sectionMarker) {
    return `${relativePath}::${sectionMarker || ''}`;
}
class PublicationPlanService {
    resolveAssetRefFromUrlRef(plan, urlRef) {
        if (!urlRef || typeof urlRef !== 'string')
            return null;
        if (plan.assets?.[urlRef])
            return urlRef;
        if (urlRef.startsWith('assets.')) {
            const candidate = urlRef.slice('assets.'.length).split('.')[0];
            return plan.assets?.[candidate] ? candidate : null;
        }
        return null;
    }
    resolveContentFileDescriptor(plan, file) {
        const resolvedRef = file?.url_ref ? resolveRef(plan, file.url_ref) : null;
        const resolvedAssetRef = this.resolveAssetRefFromUrlRef(plan, file?.url_ref);
        const resolvedAsset = typeof file?.url_ref === 'string' && plan.assets?.[file.url_ref]
            ? plan.assets[file.url_ref]
            : (resolvedAssetRef ? plan.assets[resolvedAssetRef] : null);
        const directInlineContent = typeof resolvedAsset?.content === 'string'
            ? resolvedAsset.content
            : null;
        const assetCandidate = resolvedAsset && typeof resolvedAsset === 'object'
            ? resolvedAsset
            : (resolvedRef && typeof resolvedRef === 'object' ? resolvedRef : null);
        const relativePath = typeof file?.path === 'string' && file.path.trim()
            ? file.path.trim()
            : (typeof assetCandidate?.path === 'string' && assetCandidate.path.trim() ? assetCandidate.path.trim() : null);
        const resolvedUrl = assetCandidate?.target_url || (typeof resolvedRef === 'string' ? resolvedRef : file?.url || null);
        return {
            relativePath,
            resolvedUrl,
            assetCandidate,
            resolvedAssetRef,
            directInlineContent
        };
    }
    getPublicationPlanFormat() {
        return {
            version: '2026-06-publication-plan-v2',
            summary: 'Preferred planner publication-plan format for MCP and chat-generated plans.',
            top_level: {
                required: ['meta', 'accounts', 'assets', 'actions'],
                optional: ['ongoing_rules', 'measurement', 'dependencies_matrix_visualized', 'content_dictionary', 'atoma_files', 'atoma_files_description']
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
                },
                ui_mapping: {
                    title: {
                        source: 'action.display_name',
                        fallback: 'resolved runtime title from action.id/type',
                        recommendation: 'Always provide display_name so the task card and workspace header show a human-readable title.'
                    },
                    brief: {
                        source: 'action.notes',
                        fallback: 'action.human_review_reason',
                        recommendation: 'Use notes for the short task summary shown in channel and publication task cards.'
                    },
                    publication_body: {
                        source: 'action.content_files[]',
                        recommendation: 'Put the main post/article body in content_files. This is what the UI renders in the publication editor.'
                    },
                    source_files_panel: {
                        source: 'handoff_bundle.resource_files',
                        recommendation: 'Each content_files entry becomes a visible source file/resource entry in the UI.'
                    },
                    target_resource_url: {
                        source: 'action.parameters.link_url_ref',
                        recommendation: 'Use a ref that resolves to assets.<ref>.target_url or another plan URL so the UI can show the destination resource for editing/publishing.'
                    },
                    schedule: {
                        preferred: 'action.scheduled_at',
                        fallback: 'action.scheduled_date + action.scheduled_time_window',
                        recommendation: 'Use scheduled_at when possible for the most predictable UI sorting.'
                    }
                }
            },
            ui_ready_recipes: {
                inline_body_asset: {
                    when_to_use: 'When the full publication text is generated directly in chat/MCP and should be stored inside the plan.',
                    assets: {
                        body_post_1: {
                            type: 'inline_publication_body',
                            content: 'Full publication text goes here.'
                        }
                    },
                    action: {
                        display_name: 'Telegram — Founder note',
                        notes: 'Short summary for the task card.',
                        scheduled_at: '2026-07-01T10:00:00Z',
                        parameters: {
                            link_url_ref: 'assets.target_article_url.target_url'
                        },
                        content_files: [
                            {
                                role: 'post_body',
                                purpose: 'Primary publication body shown in UI',
                                url_ref: 'body_post_1'
                            }
                        ]
                    }
                },
                file_backed_body: {
                    when_to_use: 'When the full text already exists in a markdown/html file in the content workspace.',
                    assets: {
                        article_source_1: {
                            type: 'markdown_source',
                            path: 'content/weeks/w01.md'
                        }
                    },
                    action: {
                        display_name: 'LinkedIn — Thought piece',
                        notes: 'Short summary for the task card.',
                        scheduled_at: '2026-07-01T10:00:00Z',
                        content_files: [
                            {
                                role: 'post_body',
                                purpose: 'Primary publication body shown in UI',
                                path: 'content/weeks/w01.md',
                                section_marker: '## Founder voice 1'
                            }
                        ]
                    }
                }
            },
            recommendations: [
                'Use asset.content only for compact inline text or preview notes.',
                'Use action.content_files for the full publication body, markdown sections, or HTML fragments.',
                'If you want inline body text to render in UI, store it in assets.<body_ref>.content and reference it from action.content_files[].url_ref.',
                'If you want a short description on task cards, put it in action.notes.',
                'If you want the destination/resource link in UI, put a plan ref into action.parameters.link_url_ref.',
                'If you want reliable schedule sorting in UI, prefer action.scheduled_at.',
                'Use unique section_marker values that match stable headings in the source file.',
                'If a post depends on a full markdown section, make that dependency explicit in content_files.',
                'Attach content_dictionary to import glossary/style rules together with the publication plan.',
                'Attach atoma_files and atoma_files_description when the critic should validate against atomized source context.'
            ]
        };
    }
    getPublicationPlanTemplate(input = {}) {
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
                body_inline_1: {
                    type: 'inline_publication_body',
                    content: 'Полный текст публикации, который UI должен сразу показать в редакторе публикации.'
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
                    scheduled_at: '2026-06-03T10:00:00Z',
                    asset_refs: ['teaser_note_1'],
                    content_files: [
                        {
                            role: 'post_body',
                            purpose: 'Основной текст публикации, отображаемый в UI',
                            url_ref: 'body_inline_1'
                        },
                        {
                            role: 'source_context',
                            purpose: 'Полный текст публикации',
                            path: 'weeks/w01.md',
                            section_marker: 'Idea 1 — «Название секции»'
                        }
                    ],
                    parameters: {
                        link_url_ref: 'assets.target_article_url.target_url'
                    },
                    notes: 'Краткий комментарий по задаче. Это поле попадает в short summary карточки.'
                }
            ],
            ongoing_rules: [],
            measurement: {},
            content_dictionary: {
                terms: [],
                style_rules: {
                    required_phrases: [],
                    forbidden_phrases: [],
                    preferred_tone: 'direct, practical, non-generic'
                }
            },
            atoma_files_description: 'Описание atomized source files и правил их использования для редактора/критика.',
            atoma_files: {
                source_map: [],
                editorial_rules: []
            }
        };
    }
    normalizePublicationPlan(raw) {
        const parsed = this.parsePlan(raw);
        const warnings = [];
        const normalized = {
            ...parsed,
            ongoing_rules: Array.isArray(parsed.ongoing_rules) ? parsed.ongoing_rules : [],
            measurement: parsed.measurement || {},
            actions: parsed.actions.map((action) => {
                const normalizedAction = {
                    ...action,
                    asset_refs: Array.isArray(action.asset_refs) ? action.asset_refs : [],
                    content_files: Array.isArray(action.content_files)
                        ? action.content_files
                            .filter(Boolean)
                            .map((entry) => ({
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
                if (!normalizedAction.notes && !normalizedAction.human_review_reason) {
                    warnings.push(`Action '${action.id}' is missing notes. UI task cards will have no short summary.`);
                }
                if (!normalizedAction.scheduled_at && !normalizedAction.scheduled_date) {
                    warnings.push(`Action '${action.id}' is missing scheduled_at or scheduled_date. UI sorting may be unstable.`);
                }
                if (normalizedAction.content_files.length === 0 && normalizedAction.asset_refs.length > 0) {
                    const inlineOnlyRefs = normalizedAction.asset_refs.filter((ref) => {
                        const asset = parsed.assets?.[ref];
                        return asset && typeof asset.content === 'string' && !asset.path;
                    });
                    if (inlineOnlyRefs.length > 0) {
                        warnings.push(`Action '${action.id}' relies on inline asset content (${inlineOnlyRefs.join(', ')}). Add content_files for full text if this should render a complete draft.`);
                    }
                }
                normalizedAction.content_files.forEach((entry, index) => {
                    if (!entry.path && !entry.url && !entry.url_ref) {
                        warnings.push(`Action '${action.id}' content_files[${index}] should define path, url, or url_ref.`);
                    }
                    if (entry.url_ref) {
                        const assetRef = this.resolveAssetRefFromUrlRef(parsed, entry.url_ref);
                        if (!assetRef && typeof entry.url_ref === 'string' && !entry.url_ref.startsWith('http')) {
                            warnings.push(`Action '${action.id}' content_files[${index}] uses url_ref='${entry.url_ref}', but no asset with that ref exists. Use assets.<ref> and point url_ref to that ref.`);
                        }
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
    parsePlan(raw) {
        const parsed = JSON.parse(raw);
        if (!parsed?.meta?.plan_id || !parsed?.accounts || !parsed?.assets || !Array.isArray(parsed?.actions)) {
            throw new Error('Invalid publication plan: expected meta.plan_id, accounts, assets, actions[]');
        }
        return parsed;
    }
    collectReferencedRelativePaths(plan) {
        const paths = new Set();
        for (const asset of Object.values(plan.assets || {})) {
            if (typeof asset?.path === 'string' && asset.path.trim()) {
                paths.add(asset.path.trim());
            }
        }
        for (const action of plan.actions || []) {
            const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
            for (const file of contentFiles) {
                const descriptor = this.resolveContentFileDescriptor(plan, file);
                if (descriptor.relativePath) {
                    paths.add(descriptor.relativePath);
                }
            }
        }
        return [...paths];
    }
    discoverWorkspaceRoots() {
        const roots = new Set();
        roots.add(process.cwd());
        roots.add(path.dirname(process.cwd()));
        const parent = path.dirname(process.cwd());
        try {
            for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.name.startsWith('.'))
                    continue;
                roots.add(path.join(parent, entry.name));
            }
        }
        catch {
            // Ignore directory listing failures and fall back to known roots.
        }
        return [...roots];
    }
    derivePlanPathRoots(planPath) {
        if (!planPath)
            return [];
        const roots = [];
        let current = path.dirname(path.resolve(planPath));
        for (let depth = 0; depth < 4; depth += 1) {
            roots.push(current);
            const parent = path.dirname(current);
            if (parent === current)
                break;
            current = parent;
        }
        return roots;
    }
    resolveImportPipelineRoot(plan, workspaceRoots = [], planPath) {
        const referencedPaths = this.collectReferencedRelativePaths(plan);
        if (referencedPaths.length === 0) {
            return plan.meta.pipeline_root || null;
        }
        const candidateRoots = [
            ...(plan.meta.pipeline_root ? [plan.meta.pipeline_root] : []),
            ...workspaceRoots,
            ...this.derivePlanPathRoots(planPath),
            ...this.discoverWorkspaceRoots()
        ]
            .map((entry) => path.resolve(entry))
            .filter((entry, index, list) => Boolean(entry) && list.indexOf(entry) === index);
        let bestRoot = null;
        let bestScore = -1;
        for (const candidate of candidateRoots) {
            let score = 0;
            for (const relativePath of referencedPaths) {
                if (fs.existsSync(path.resolve(candidate, relativePath))) {
                    score += 1;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestRoot = candidate;
            }
        }
        if (bestScore > 0 && bestRoot) {
            return bestRoot;
        }
        return plan.meta.pipeline_root || null;
    }
    loadPlanFromPath(planPath) {
        const raw = fs.readFileSync(planPath, 'utf8');
        return this.parsePlan(raw);
    }
    buildContentFileSnapshots(plan, existingSnapshots = {}) {
        const snapshots = {};
        for (const action of plan.actions || []) {
            const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
            for (const file of contentFiles) {
                const descriptor = this.resolveContentFileDescriptor(plan, file);
                const relativePath = descriptor.relativePath || '';
                if (!relativePath)
                    continue;
                const sectionMarker = file.section_marker || null;
                const snapshotKey = contentFileSnapshotKey(relativePath, sectionMarker);
                const syntheticAsset = {
                    path: relativePath,
                    section_marker: sectionMarker
                };
                const resolved = this.readAssetContent(plan, syntheticAsset, relativePath);
                if (resolved?.content) {
                    snapshots[snapshotKey] = {
                        key: snapshotKey,
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
                const previous = existingSnapshots[snapshotKey];
                if (previous?.content) {
                    snapshots[snapshotKey] = {
                        ...previous,
                        key: snapshotKey,
                        relative_path: relativePath,
                        file_name: path.basename(relativePath),
                        section_marker: sectionMarker,
                        source: 'preserved',
                        source_available: false
                    };
                }
            }
        }
        return snapshots;
    }
    async importPlan(params) {
        const plan = params.rawPlan
            ? this.parsePlan(params.rawPlan)
            : this.loadPlanFromPath(params.planPath || '');
        const resolvedPipelineRoot = this.resolveImportPipelineRoot(plan, params.workspaceRoots || [], params.planPath);
        if (resolvedPipelineRoot) {
            plan.meta.pipeline_root = resolvedPipelineRoot;
        }
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
        const existingSnapshots = existingProject
            ? await this.loadAssetSnapshots(existingProject.id)
            : {};
        const assetSnapshots = this.buildAssetSnapshots(plan, existingSnapshots);
        const existingContentFileSnapshots = existingProject
            ? await this.loadContentFileSnapshots(existingProject.id)
            : {};
        const contentFileSnapshots = this.buildContentFileSnapshots(plan, existingContentFileSnapshots);
        const dictionaryYaml = plan.content_dictionary !== undefined
            ? content_dictionary_service_1.default.normalizeToYaml(plan.content_dictionary)
            : null;
        const atomaFilesDescription = plan.atoma_files_description === undefined
            ? null
            : (typeof plan.atoma_files_description === 'string'
                ? plan.atoma_files_description.trim()
                : JSON.stringify(plan.atoma_files_description));
        const atomaFilesPayload = plan.atoma_files === undefined
            ? null
            : JSON.stringify(plan.atoma_files);
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
            const existingChannels = await tx.socialChannel.findMany({
                where: { project_id: project.id }
            });
            const existingImportedItems = (await tx.contentItem.findMany({
                where: { project_id: project.id }
            })).filter(isExternalPublicationPlanItem);
            const existingImportedItemsByTaskId = new Map(existingImportedItems
                .map((item) => [getImportedTaskId(item), item]));
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
                    key: 'publication_plan_content_file_snapshots',
                    value: JSON.stringify(contentFileSnapshots)
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
                },
                ...(dictionaryYaml ? [{
                        project_id: project.id,
                        key: 'content_dictionary_yaml',
                        value: dictionaryYaml
                    }] : []),
                ...(atomaFilesDescription ? [{
                        project_id: project.id,
                        key: 'atoma_files_description',
                        value: atomaFilesDescription
                    }] : []),
                ...(atomaFilesPayload ? [{
                        project_id: project.id,
                        key: 'atoma_files_payload',
                        value: atomaFilesPayload
                    }] : [])
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
                const channelConfig = publication_adapter_service_1.default.buildAdapterConfig(accountRef, account, accountActions[accountRef]);
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
            }));
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
                narrative_arc: plan.meta,
                channel_mix: Object.fromEntries(Object.entries(plan.accounts).map(([key, value]) => [key, value.platform])),
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
            const importedTaskIds = new Set();
            for (const action of plan.actions) {
                const schedule = computeSchedule(action, plan.meta.timezone_default);
                const resolvedAssets = (action.asset_refs || []).map((ref) => ({
                    ref,
                    asset: plan.assets[ref] || null
                }));
                const account = plan.accounts[action.account_ref] || {};
                const executionMode = publication_adapter_service_1.default.inferExecutionMode(account, action);
                const mappedStatus = (0, publication_runtime_helpers_1.mapActionStatus)(action.status);
                const publicationOutcome = derivePublicationOutcome(action);
                const taskId = String(action.id);
                importedTaskIds.add(taskId);
                const itemData = {
                    project_id: project.id,
                    week_package_id: weekPackage.id,
                    channel_id: channelMap.get(action.account_ref) || null,
                    type: `${action.channel}:${action.action_type}`,
                    layer: action.channel,
                    title: (0, publication_runtime_helpers_1.resolveActionTitle)(action),
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
                    },
                    metrics: {
                        publication_plan_id: plan.meta.plan_id,
                        task_id: taskId,
                        task_display_name: action.display_name || null,
                        timezone: schedule?.timezone || plan.meta.timezone_default || null,
                        account_ref: action.account_ref,
                        publication_outcome: publicationOutcome,
                        monitoring: publication_adapter_service_1.default.deriveMonitoringPlan(action)
                    },
                    published_link: action.status === 'completed'
                        ? action.verification?.find((item) => item.type === 'post_live_check')?.url || null
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
                                    ...(existingItem.assets || {}),
                                    ...itemData.assets
                                },
                                quality_report: {
                                    ...(existingItem.quality_report || {}),
                                    ...itemData.quality_report
                                },
                                metrics: {
                                    ...(existingItem.metrics || {}),
                                    ...itemData.metrics
                                },
                                published_link: existingItem.published_link || itemData.published_link
                            }
                        })
                    : await tx.contentItem.create({
                        data: itemData
                    });
                const gscPostActions = (action.post_actions || []).filter((item) => item.type === 'submit_to_gsc' || item.type === 'gsc_url_inspection');
                for (const postAction of gscPostActions) {
                    if (!gscChannel)
                        continue;
                    const followupTaskId = `${action.id}:${postAction.type}`;
                    importedTaskIds.add(followupTaskId);
                    const followupData = {
                        project_id: project.id,
                        week_package_id: weekPackage.id,
                        channel_id: gscChannel.id,
                        type: `google_search_console:${postAction.type}`,
                        layer: 'google_search_console',
                        title: `${(0, publication_runtime_helpers_1.resolveActionTitle)(action)} · ${postAction.type}`,
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
                        },
                        quality_report: {
                            execution_mode: 'automated',
                            verification: [],
                            post_actions: []
                        },
                        metrics: {
                            publication_plan_id: plan.meta.plan_id,
                            task_id: followupTaskId,
                            task_display_name: action.display_name ? `${action.display_name} · ${postAction.type}` : null,
                            account_ref: gscChannel.name,
                            monitoring: {
                                needs_analytics_collection: true
                            }
                        }
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
                                    ...(existingFollowup.assets || {}),
                                    ...followupData.assets
                                },
                                quality_report: {
                                    ...(existingFollowup.quality_report || {}),
                                    ...followupData.quality_report
                                },
                                metrics: {
                                    ...(existingFollowup.metrics || {}),
                                    ...followupData.metrics
                                },
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
                    contentFileSnapshots: Object.keys(contentFileSnapshots).length,
                    ongoingRules: (plan.ongoing_rules || []).length,
                    updatedExistingProject: Boolean(existingProject)
                }
            };
        });
    }
    readAssetContent(plan, asset, relativePath) {
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
        const sectionContent = asset.section_marker ? resolveSection(rawContent, asset.section_marker) : rawContent;
        return {
            fullPath,
            content: sectionContent && sectionContent.trim() ? sectionContent : rawContent
        };
    }
    buildAssetSnapshots(plan, existingSnapshots = {}, overrides = {}) {
        const snapshots = {};
        for (const [ref, asset] of Object.entries(plan.assets || {})) {
            const relativePath = typeof asset?.path === 'string' ? asset.path : null;
            const sectionMarker = asset?.section_marker || null;
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
            const inlineContent = typeof asset?.content === 'string' ? asset.content : null;
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
    resolveAssetRuntime(plan, assetRef, maxChars) {
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
    async loadAssetSnapshots(projectId) {
        const snapshots = await db_1.default.projectSettings.findFirst({
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
        }
        catch {
            return {};
        }
    }
    async loadContentFileSnapshots(projectId) {
        const snapshots = await db_1.default.projectSettings.findFirst({
            where: {
                project_id: projectId,
                key: 'publication_plan_content_file_snapshots'
            }
        });
        if (!snapshots?.value) {
            return {};
        }
        try {
            return JSON.parse(snapshots.value);
        }
        catch {
            return {};
        }
    }
    async saveAssetSnapshots(projectId, snapshots) {
        await db_1.default.projectSettings.upsert({
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
    async refreshAssetSnapshots(projectId, plan, overrides = {}) {
        const existing = await this.loadAssetSnapshots(projectId);
        const snapshots = this.buildAssetSnapshots(plan, existing, overrides);
        await this.saveAssetSnapshots(projectId, snapshots);
        return snapshots;
    }
    buildHandoffBundle(plan, item) {
        const action = item.assets?.action || {};
        const accountRef = item.assets?.account_ref || null;
        const account = accountRef ? plan.accounts[accountRef] : null;
        const assetRefs = item.assets?.asset_refs || [];
        const resolvedAssets = assetRefs.map((ref) => this.resolveAssetRuntime(plan, ref));
        const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
        const resolvedContentFiles = contentFiles.map((file, index) => {
            const descriptor = this.resolveContentFileDescriptor(plan, file);
            const relativePath = descriptor.relativePath;
            const resolvedUrl = descriptor.resolvedUrl;
            const assetRuntime = descriptor.resolvedAssetRef
                ? this.resolveAssetRuntime(plan, descriptor.resolvedAssetRef)
                : null;
            let content = null;
            let exists = false;
            let fullPath = null;
            let contentSource = null;
            const snapshotKey = relativePath ? contentFileSnapshotKey(relativePath, file.section_marker || null) : null;
            const snapshot = snapshotKey ? plan.content_file_snapshots?.[snapshotKey] || null : null;
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
                    contentSource = 'filesystem';
                }
            }
            if (!content && snapshot?.content) {
                content = snapshot.content;
                contentSource = snapshot.source || 'snapshot';
            }
            if (!content && assetRuntime?.content) {
                content = assetRuntime.content;
                exists = assetRuntime.exists === true;
                fullPath = assetRuntime.full_path || fullPath;
                contentSource = assetRuntime.content_source || null;
            }
            return {
                ref: `content_file_${index + 1}`,
                type: 'content_file',
                role: file.role || null,
                purpose: file.purpose || null,
                file_name: relativePath
                    ? path.basename(relativePath)
                    : (assetRuntime?.file_name || (descriptor.resolvedAssetRef || null)),
                relative_path: relativePath,
                full_path: fullPath,
                section_marker: file.section_marker || assetRuntime?.section_marker || null,
                exists: exists || Boolean(snapshot?.content) || assetRuntime?.exists === true,
                url: resolvedUrl,
                content,
                snapshot_available: Boolean(snapshot?.content) || Boolean(assetRuntime?.snapshot_available),
                content_source: contentSource
            };
        });
        const primaryTextAsset = [...resolvedContentFiles, ...resolvedAssets].find((entry) => typeof entry.content === 'string' && entry.content.trim());
        const linkUrl = resolveRef(plan, action.parameters?.link_url_ref || item.cta || null);
        const resourceFiles = dedupeResourceFiles([
            ...resolvedContentFiles,
            ...resolvedAssets.map((entry) => ({
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
            mode: publication_adapter_service_1.default.inferExecutionMode(account || {}, action),
            account: {
                ref: accountRef,
                details: account
            },
            task: {
                id: action.id || item.id,
                display_name: action.display_name || item.title || null,
                channel: action.channel || item.layer,
                action_type: action.action_type || item.type,
                schedule_at: action.scheduled_at || item.schedule_at?.toISOString?.() || item.schedule_at || null,
                scheduled_date: action.scheduled_date || item.schedule_at,
                time_window: action.scheduled_time_window || null
            },
            publication: {
                body: primaryTextAsset?.content || item.draft_text || '',
                html_bundle: resolvedAssets.filter((entry) => entry.asset?.type?.includes('html')),
                link_url: linkUrl,
                visuals: resolvedAssets.filter((entry) => entry.asset?.visual_style || entry.asset?.gamma_source)
            },
            resource_files: resourceFiles,
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
