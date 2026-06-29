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
exports.asToolResult = asToolResult;
exports.createPlannerMcpServer = createPlannerMcpServer;
exports.registerPlannerTools = registerPlannerTools;
exports.shutdownMcpResources = shutdownMcpResources;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const db_1 = __importStar(require("../db"));
const mcp_publication_service_1 = __importDefault(require("../services/mcp_publication.service"));
function asToolResult(payload) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2)
            }
        ],
        structuredContent: payload
    };
}
function createPlannerMcpServer() {
    const server = new mcp_js_1.McpServer({
        name: 'ba-post-planner-publication',
        version: '1.0.0'
    });
    registerPlannerTools(server);
    return server;
}
function registerPlannerTools(server) {
    server.registerTool('ba_get_publication_plan_format', {
        description: 'Return the preferred machine-readable publication-plan contract for chat/MCP authoring.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {}
    }, async () => {
        const format = mcp_publication_service_1.default.getPublicationPlanFormat();
        return asToolResult({ format });
    });
    server.registerTool('ba_get_publication_plan_template', {
        description: 'Return a ready-to-fill publication-plan JSON template for chat-based authoring.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            planId: zod_1.z.string().optional(),
            projectName: zod_1.z.string().optional(),
            owner: zod_1.z.string().optional(),
            timezone: zod_1.z.string().optional(),
            channelRef: zod_1.z.string().optional(),
            channelPlatform: zod_1.z.string().optional()
        }
    }, async (input) => {
        const template = mcp_publication_service_1.default.getPublicationPlanTemplate(input);
        return asToolResult({ template });
    });
    server.registerTool('ba_normalize_publication_plan_json', {
        description: 'Validate and normalize a publication-plan JSON payload produced by chat before import.',
        inputSchema: {
            planJson: zod_1.z.string().min(2)
        }
    }, async ({ planJson }) => {
        const result = mcp_publication_service_1.default.normalizePublicationPlan(planJson);
        return asToolResult(result);
    });
    server.registerTool('ba_list_users', {
        description: 'List planner users with their IDs and linked umbrella projects.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            includeArchivedProjects: zod_1.z.boolean().optional()
        }
    }, async ({ includeArchivedProjects }) => {
        const users = await mcp_publication_service_1.default.listUsers({ includeArchivedProjects });
        return asToolResult({ users });
    });
    server.registerTool('ba_get_user', {
        description: 'Fetch one planner user by ID, including linked projects and roles.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            includeArchivedProjects: zod_1.z.boolean().optional()
        }
    }, async ({ userId, includeArchivedProjects }) => {
        const user = await mcp_publication_service_1.default.getUser(userId, { includeArchivedProjects });
        return asToolResult({ user });
    });
    server.registerTool('ba_list_projects', {
        description: 'List planner projects that can be used for publication workflows.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive().optional(),
            includeArchived: zod_1.z.boolean().optional()
        }
    }, async ({ userId, includeArchived }) => {
        const projects = await mcp_publication_service_1.default.listProjects({ userId, includeArchived });
        return asToolResult({ projects });
    });
    server.registerTool('ba_create_project', {
        description: 'Create a new umbrella project that can hold multiple channels, content items, parser results, and publication tasks.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1),
            slug: zod_1.z.string().optional(),
            description: zod_1.z.string().optional(),
            kind: zod_1.z.string().optional().describe('Optional project kind. Defaults to content_network.')
        }
    }, async ({ userId, name, slug, description, kind }) => {
        const result = await mcp_publication_service_1.default.createProject({ userId, name, slug, description, kind });
        return asToolResult(result);
    });
    server.registerTool('ba_update_project', {
        description: 'Update umbrella project metadata such as name, slug, description, or kind.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().optional(),
            slug: zod_1.z.string().optional(),
            description: zod_1.z.string().nullable().optional(),
            kind: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, name, slug, description, kind }) => {
        const result = await mcp_publication_service_1.default.updateProject({ userId, projectId, name, slug, description, kind });
        return asToolResult(result);
    });
    server.registerTool('ba_archive_project', {
        description: 'Archive or unarchive a project while keeping its channels and content network intact.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            archived: zod_1.z.boolean().optional().describe('Defaults to true. Pass false to unarchive a project.')
        }
    }, async ({ userId, projectId, archived }) => {
        const result = await mcp_publication_service_1.default.archiveProject({ userId, projectId, archived });
        return asToolResult(result);
    });
    server.registerTool('ba_parser_health', {
        description: 'Check parser connectivity from the planner context for a specific project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcp_publication_service_1.default.getParserHealth(projectId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_create_search_job', {
        description: 'Create and queue a parser search job for a planner project.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            source: zod_1.z.enum(['reddit', 'indie_hackers']).optional(),
            query: zod_1.z.string().min(1),
            subreddit: zod_1.z.string().optional(),
            subreddits: zod_1.z.array(zod_1.z.string()).optional(),
            queryDefinitionId: zod_1.z.string().optional(),
            intent: zod_1.z.string().optional(),
            cluster: zod_1.z.string().optional(),
            priority: zod_1.z.number().int().optional(),
            matchMustIncludeAny: zod_1.z.array(zod_1.z.string()).optional(),
            excludeIfContains: zod_1.z.array(zod_1.z.string()).optional(),
            excludeRegexes: zod_1.z.array(zod_1.z.string()).optional(),
            limit: zod_1.z.number().int().positive().optional(),
            minScore: zod_1.z.number().int().optional(),
            dateFrom: zod_1.z.string().optional(),
            dateTo: zod_1.z.string().optional(),
            includeComments: zod_1.z.boolean().optional(),
            enrich: zod_1.z.boolean().optional(),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (input) => {
        const result = await mcp_publication_service_1.default.createParserSearchJob(input);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_get_search_job', {
        description: 'Fetch one parser search job and its latest run state for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            jobId: zod_1.z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcp_publication_service_1.default.getParserSearchJob(projectId, jobId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_refresh_search_job', {
        description: 'Queue a refresh run for an existing parser search job.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            jobId: zod_1.z.string().min(1),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, jobId, idempotencyKey }) => {
        const result = await mcp_publication_service_1.default.refreshParserSearchJob(projectId, jobId, userId, idempotencyKey);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_list_posts', {
        description: 'List parser-normalized posts available to a planner project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            limit: zod_1.z.number().int().positive().optional(),
            offset: zod_1.z.number().int().nonnegative().optional()
        }
    }, async ({ userId, projectId, limit, offset }) => {
        const result = await mcp_publication_service_1.default.listParserPosts(projectId, userId, limit, offset);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_get_insights', {
        description: 'List planner-friendly parser insights for a project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            limit: zod_1.z.number().int().positive().optional(),
            offset: zod_1.z.number().int().nonnegative().optional(),
            jobId: zod_1.z.string().optional(),
            type: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, limit, offset, jobId, type }) => {
        const result = await mcp_publication_service_1.default.getParserInsights(projectId, userId, {
            limit,
            offset,
            jobId,
            type
        });
        return asToolResult(result);
    });
    server.registerTool('ba_parser_get_summary', {
        description: 'Fetch a planner-ready summary for one parser job.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            jobId: zod_1.z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcp_publication_service_1.default.getParserSummary(projectId, jobId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_list_templates', {
        description: 'List saved parser search templates for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcp_publication_service_1.default.listParserTemplates(projectId, userId);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_import_templates', {
        description: 'Import parser search templates from YAML content or a structured query bank.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            yamlContent: zod_1.z.string().optional(),
            queryBank: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
            scheduleDaily: zod_1.z.boolean().optional(),
            limit: zod_1.z.number().int().positive().optional(),
            minScore: zod_1.z.number().int().optional(),
            dateFrom: zod_1.z.string().optional(),
            dateTo: zod_1.z.string().optional(),
            includeComments: zod_1.z.boolean().optional(),
            enrich: zod_1.z.boolean().optional(),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async (input) => {
        const result = await mcp_publication_service_1.default.importParserTemplates(input);
        return asToolResult(result);
    });
    server.registerTool('ba_parser_run_template', {
        description: 'Queue an immediate parser run for a saved template.',
        inputSchema: {
            userId: zod_1.z.number().int().positive(),
            projectId: zod_1.z.number().int().positive(),
            templateId: zod_1.z.string().min(1),
            idempotencyKey: zod_1.z.string().optional()
        }
    }, async ({ userId, projectId, templateId, idempotencyKey }) => {
        const result = await mcp_publication_service_1.default.runParserTemplate(projectId, templateId, userId, idempotencyKey);
        return asToolResult(result);
    });
    server.registerTool('ba_import_publication_plan_json', {
        description: 'Import a publication plan JSON payload into the planner and create or update the corresponding project.',
        inputSchema: {
            userId: zod_1.z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planJson: zod_1.z.string().min(2).describe('Full publication plan JSON string with meta.plan_id, accounts, assets, and actions[].'),
            workspaceRoots: zod_1.z.array(zod_1.z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.')
        }
    }, async ({ userId, planJson, workspaceRoots }) => {
        const result = await mcp_publication_service_1.default.importPublicationPlanJson(planJson, userId, workspaceRoots);
        return asToolResult(result);
    });
    server.registerTool('ba_import_publication_plan_file', {
        description: 'Import a publication plan from a local JSON file path and create or update the corresponding project.',
        inputSchema: {
            userId: zod_1.z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planPath: zod_1.z.string().min(1).describe('Absolute or local filesystem path to a publication plan JSON file.'),
            workspaceRoots: zod_1.z.array(zod_1.z.string()).optional().describe('Optional local workspace roots where referenced content files can be resolved during import.')
        }
    }, async ({ userId, planPath, workspaceRoots }) => {
        const result = await mcp_publication_service_1.default.importPublicationPlanFile(planPath, userId, workspaceRoots);
        return asToolResult(result);
    });
    server.registerTool('ba_list_publication_plan_assets', {
        description: 'List file-backed assets from an imported publication plan for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const result = await mcp_publication_service_1.default.listPublicationPlanAssets(projectId);
        return asToolResult(result);
    });
    server.registerTool('ba_read_publication_plan_asset', {
        description: 'Read the content of a file-backed asset from an imported publication plan.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            assetRef: zod_1.z.string().min(1),
            maxChars: zod_1.z.number().int().positive().optional().describe('Optional maximum characters to return, default 20000.')
        }
    }, async ({ projectId, assetRef, maxChars }) => {
        const result = await mcp_publication_service_1.default.readPublicationPlanAsset(projectId, assetRef, maxChars);
        return asToolResult(result);
    });
    server.registerTool('ba_refresh_publication_plan_asset_snapshots', {
        description: 'Refresh stored publication-plan asset snapshots from the runtime filesystem and optional inline content overrides.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            assetContents: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
                content: zod_1.z.string(),
                contentType: zod_1.z.string().optional()
            })).optional().describe('Optional assetRef -> content map used when files are not available in the current runtime.')
        }
    }, async ({ projectId, assetContents }) => {
        const result = await mcp_publication_service_1.default.refreshPublicationPlanAssetSnapshots(projectId, assetContents || {});
        return asToolResult(result);
    });
    server.registerTool('ba_read_publication_plan_ref', {
        description: 'Resolve a publication plan reference such as article_knowledge.target_url or an asset ref and return its value.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            ref: zod_1.z.string().min(1),
            maxChars: zod_1.z.number().int().positive().optional().describe('Optional maximum characters to return when the ref resolves to file-backed content.')
        }
    }, async ({ projectId, ref, maxChars }) => {
        const result = await mcp_publication_service_1.default.readPublicationPlanRef(projectId, ref, maxChars);
        return asToolResult(result);
    });
    server.registerTool('ba_list_project_channels', {
        description: 'List active and inactive social channels for a planner project. Sensitive config values are redacted.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const channels = await mcp_publication_service_1.default.listChannels(projectId);
        return asToolResult({ project_id: projectId, channels });
    });
    server.registerTool('ba_list_publication_tasks', {
        description: 'List ContentItem-based publication tasks for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            status: zod_1.z.string().optional().describe("Optional task status, or use 'active' for the main queue view."),
            manualOnly: zod_1.z.boolean().optional()
        }
    }, async ({ projectId, status, manualOnly }) => {
        const tasks = await mcp_publication_service_1.default.listPublicationTasks(projectId, status, manualOnly);
        return asToolResult({ project_id: projectId, tasks });
    });
    server.registerTool('ba_get_publication_task', {
        description: 'Fetch the full details of a single publication task.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const task = await mcp_publication_service_1.default.getPublicationTask(projectId, taskId);
        return asToolResult({ project_id: projectId, task });
    });
    server.registerTool('ba_get_publication_task_resources', {
        description: 'Read the resolved resource files for a publication task, including action content files and asset-backed content.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive(),
            maxChars: zod_1.z.number().int().positive().optional().describe('Optional maximum characters per resource, default 12000.')
        }
    }, async ({ projectId, taskId, maxChars }) => {
        const result = await mcp_publication_service_1.default.getPublicationTaskResources(projectId, taskId, maxChars);
        return asToolResult(result);
    });
    server.registerTool('ba_prepare_publication_task', {
        description: 'Prepare or reuse a handoff bundle for a publication task before manual publication.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const result = await mcp_publication_service_1.default.preparePublicationTask(projectId, taskId);
        return asToolResult(result);
    });
    server.registerTool('ba_confirm_publication', {
        description: 'Mark a publication task as published after a manual handoff or an external publish step.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            taskId: zod_1.z.number().int().positive(),
            publishedLink: zod_1.z.string().url(),
            note: zod_1.z.string().optional(),
            outcome: zod_1.z.enum(['published', 'blocked', 'removed', 'restricted']).optional()
        }
    }, async ({ projectId, taskId, publishedLink, note, outcome }) => {
        const task = await mcp_publication_service_1.default.confirmPublication(projectId, taskId, publishedLink, note, outcome);
        return asToolResult({ project_id: projectId, task });
    });
    server.registerTool('ba_publish_direct', {
        description: 'Publish content directly to a configured project channel. Supports reddit, telegram, vk, and linkedin.',
        inputSchema: {
            projectId: zod_1.z.number().int().positive(),
            channelId: zod_1.z.number().int().positive().optional(),
            channelType: zod_1.z.enum(['reddit', 'telegram', 'vk', 'linkedin']).optional(),
            title: zod_1.z.string().optional().describe('Required for reddit publication.'),
            text: zod_1.z.string().min(1),
            subreddit: zod_1.z.string().optional().describe('Required for reddit publication. Example: artificial or r/artificial'),
            imageUrl: zod_1.z.string().optional().describe('Optional remote URL, data URI, or /uploads/... path supported by the channel adapter.'),
            dryRun: zod_1.z.boolean().optional().describe('When true, validate channel resolution and preview the payload without publishing.')
        }
    }, async ({ projectId, channelId, channelType, title, text, subreddit, imageUrl, dryRun }) => {
        const result = await mcp_publication_service_1.default.publishDirect({
            projectId,
            channelId,
            channelType,
            title,
            text,
            subreddit,
            imageUrl,
            dryRun
        });
        return asToolResult(result);
    });
}
async function shutdownMcpResources() {
    try {
        await db_1.default.$disconnect();
    }
    catch (_error) {
        // Ignore shutdown errors.
    }
    try {
        await db_1.pool.end();
    }
    catch (_error) {
        // Ignore shutdown errors.
    }
}
