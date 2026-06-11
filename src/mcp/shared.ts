import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import prisma, { pool } from '../db';
import mcpPublicationService from '../services/mcp_publication.service';

export function asToolResult<T extends Record<string, unknown>>(payload: T) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(payload, null, 2)
            }
        ],
        structuredContent: payload
    };
}

export function createPlannerMcpServer() {
    const server = new McpServer({
        name: 'ba-post-planner-publication',
        version: '1.0.0'
    });

    registerPlannerTools(server);
    return server;
}

export function registerPlannerTools(server: McpServer) {
    server.registerTool('ba_list_users', {
        description: 'List planner users with their IDs and linked umbrella projects.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            includeArchivedProjects: z.boolean().optional()
        }
    }, async ({ includeArchivedProjects }) => {
        const users = await mcpPublicationService.listUsers({ includeArchivedProjects });
        return asToolResult({ users });
    });

    server.registerTool('ba_get_user', {
        description: 'Fetch one planner user by ID, including linked projects and roles.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            includeArchivedProjects: z.boolean().optional()
        }
    }, async ({ userId, includeArchivedProjects }) => {
        const user = await mcpPublicationService.getUser(userId, { includeArchivedProjects });
        return asToolResult({ user });
    });

    server.registerTool('ba_list_projects', {
        description: 'List planner projects that can be used for publication workflows.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive().optional(),
            includeArchived: z.boolean().optional()
        }
    }, async ({ userId, includeArchived }) => {
        const projects = await mcpPublicationService.listProjects({ userId, includeArchived });
        return asToolResult({ projects });
    });

    server.registerTool('ba_create_project', {
        description: 'Create a new umbrella project that can hold multiple channels, content items, parser results, and publication tasks.',
        inputSchema: {
            userId: z.number().int().positive(),
            name: z.string().min(1),
            slug: z.string().optional(),
            description: z.string().optional(),
            kind: z.string().optional().describe('Optional project kind. Defaults to content_network.')
        }
    }, async ({ userId, name, slug, description, kind }) => {
        const result = await mcpPublicationService.createProject({ userId, name, slug, description, kind });
        return asToolResult(result);
    });

    server.registerTool('ba_update_project', {
        description: 'Update umbrella project metadata such as name, slug, description, or kind.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            name: z.string().optional(),
            slug: z.string().optional(),
            description: z.string().nullable().optional(),
            kind: z.string().optional()
        }
    }, async ({ userId, projectId, name, slug, description, kind }) => {
        const result = await mcpPublicationService.updateProject({ userId, projectId, name, slug, description, kind });
        return asToolResult(result);
    });

    server.registerTool('ba_archive_project', {
        description: 'Archive or unarchive a project while keeping its channels and content network intact.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            archived: z.boolean().optional().describe('Defaults to true. Pass false to unarchive a project.')
        }
    }, async ({ userId, projectId, archived }) => {
        const result = await mcpPublicationService.archiveProject({ userId, projectId, archived });
        return asToolResult(result);
    });

    server.registerTool('ba_parser_health', {
        description: 'Check parser connectivity from the planner context for a specific project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcpPublicationService.getParserHealth(projectId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_create_search_job', {
        description: 'Create and queue a parser search job for a planner project.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            source: z.enum(['reddit', 'indie_hackers']).optional(),
            query: z.string().min(1),
            subreddit: z.string().optional(),
            subreddits: z.array(z.string()).optional(),
            queryDefinitionId: z.string().optional(),
            intent: z.string().optional(),
            cluster: z.string().optional(),
            priority: z.number().int().optional(),
            matchMustIncludeAny: z.array(z.string()).optional(),
            excludeIfContains: z.array(z.string()).optional(),
            excludeRegexes: z.array(z.string()).optional(),
            limit: z.number().int().positive().optional(),
            minScore: z.number().int().optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            includeComments: z.boolean().optional(),
            enrich: z.boolean().optional(),
            idempotencyKey: z.string().optional()
        }
    }, async (input) => {
        const result = await mcpPublicationService.createParserSearchJob(input);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_get_search_job', {
        description: 'Fetch one parser search job and its latest run state for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            jobId: z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcpPublicationService.getParserSearchJob(projectId, jobId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_refresh_search_job', {
        description: 'Queue a refresh run for an existing parser search job.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            jobId: z.string().min(1),
            idempotencyKey: z.string().optional()
        }
    }, async ({ userId, projectId, jobId, idempotencyKey }) => {
        const result = await mcpPublicationService.refreshParserSearchJob(projectId, jobId, userId, idempotencyKey);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_list_posts', {
        description: 'List parser-normalized posts available to a planner project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            limit: z.number().int().positive().optional(),
            offset: z.number().int().nonnegative().optional()
        }
    }, async ({ userId, projectId, limit, offset }) => {
        const result = await mcpPublicationService.listParserPosts(projectId, userId, limit, offset);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_get_insights', {
        description: 'List planner-friendly parser insights for a project workspace.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            limit: z.number().int().positive().optional(),
            offset: z.number().int().nonnegative().optional(),
            jobId: z.string().optional(),
            type: z.string().optional()
        }
    }, async ({ userId, projectId, limit, offset, jobId, type }) => {
        const result = await mcpPublicationService.getParserInsights(projectId, userId, {
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
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            jobId: z.string().min(1)
        }
    }, async ({ userId, projectId, jobId }) => {
        const result = await mcpPublicationService.getParserSummary(projectId, jobId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_list_templates', {
        description: 'List saved parser search templates for a planner project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive()
        }
    }, async ({ userId, projectId }) => {
        const result = await mcpPublicationService.listParserTemplates(projectId, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_import_templates', {
        description: 'Import parser search templates from YAML content or a structured query bank.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            yamlContent: z.string().optional(),
            queryBank: z.record(z.string(), z.any()).optional(),
            scheduleDaily: z.boolean().optional(),
            limit: z.number().int().positive().optional(),
            minScore: z.number().int().optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            includeComments: z.boolean().optional(),
            enrich: z.boolean().optional(),
            idempotencyKey: z.string().optional()
        }
    }, async (input) => {
        const result = await mcpPublicationService.importParserTemplates(input);
        return asToolResult(result);
    });

    server.registerTool('ba_parser_run_template', {
        description: 'Queue an immediate parser run for a saved template.',
        inputSchema: {
            userId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            templateId: z.string().min(1),
            idempotencyKey: z.string().optional()
        }
    }, async ({ userId, projectId, templateId, idempotencyKey }) => {
        const result = await mcpPublicationService.runParserTemplate(projectId, templateId, userId, idempotencyKey);
        return asToolResult(result);
    });

    server.registerTool('ba_import_publication_plan_json', {
        description: 'Import a publication plan JSON payload into the planner and create or update the corresponding project.',
        inputSchema: {
            userId: z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planJson: z.string().min(2).describe('Full publication plan JSON string with meta.plan_id, accounts, assets, and actions[].')
        }
    }, async ({ userId, planJson }) => {
        const result = await mcpPublicationService.importPublicationPlanJson(planJson, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_import_publication_plan_file', {
        description: 'Import a publication plan from a local JSON file path and create or update the corresponding project.',
        inputSchema: {
            userId: z.number().int().positive().describe('Owner user ID used for project membership when a new project is created.'),
            planPath: z.string().min(1).describe('Absolute or local filesystem path to a publication plan JSON file.')
        }
    }, async ({ userId, planPath }) => {
        const result = await mcpPublicationService.importPublicationPlanFile(planPath, userId);
        return asToolResult(result);
    });

    server.registerTool('ba_list_publication_plan_assets', {
        description: 'List file-backed assets from an imported publication plan for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const result = await mcpPublicationService.listPublicationPlanAssets(projectId);
        return asToolResult(result);
    });

    server.registerTool('ba_read_publication_plan_asset', {
        description: 'Read the content of a file-backed asset from an imported publication plan.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            assetRef: z.string().min(1),
            maxChars: z.number().int().positive().optional().describe('Optional maximum characters to return, default 20000.')
        }
    }, async ({ projectId, assetRef, maxChars }) => {
        const result = await mcpPublicationService.readPublicationPlanAsset(projectId, assetRef, maxChars);
        return asToolResult(result);
    });

    server.registerTool('ba_read_publication_plan_ref', {
        description: 'Resolve a publication plan reference such as article_knowledge.target_url or an asset ref and return its value.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            ref: z.string().min(1),
            maxChars: z.number().int().positive().optional().describe('Optional maximum characters to return when the ref resolves to file-backed content.')
        }
    }, async ({ projectId, ref, maxChars }) => {
        const result = await mcpPublicationService.readPublicationPlanRef(projectId, ref, maxChars);
        return asToolResult(result);
    });

    server.registerTool('ba_list_project_channels', {
        description: 'List active and inactive social channels for a planner project. Sensitive config values are redacted.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive()
        }
    }, async ({ projectId }) => {
        const channels = await mcpPublicationService.listChannels(projectId);
        return asToolResult({ project_id: projectId, channels });
    });

    server.registerTool('ba_list_publication_tasks', {
        description: 'List ContentItem-based publication tasks for a project.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            status: z.string().optional().describe("Optional task status, or use 'active' for the main queue view."),
            manualOnly: z.boolean().optional()
        }
    }, async ({ projectId, status, manualOnly }) => {
        const tasks = await mcpPublicationService.listPublicationTasks(projectId, status, manualOnly);
        return asToolResult({ project_id: projectId, tasks });
    });

    server.registerTool('ba_get_publication_task', {
        description: 'Fetch the full details of a single publication task.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const task = await mcpPublicationService.getPublicationTask(projectId, taskId);
        return asToolResult({ project_id: projectId, task });
    });

    server.registerTool('ba_get_publication_task_resources', {
        description: 'Read the resolved resource files for a publication task, including action content files and asset-backed content.',
        annotations: {
            readOnlyHint: true
        },
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            maxChars: z.number().int().positive().optional().describe('Optional maximum characters per resource, default 12000.')
        }
    }, async ({ projectId, taskId, maxChars }) => {
        const result = await mcpPublicationService.getPublicationTaskResources(projectId, taskId, maxChars);
        return asToolResult(result);
    });

    server.registerTool('ba_prepare_publication_task', {
        description: 'Prepare or reuse a handoff bundle for a publication task before manual publication.',
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive()
        }
    }, async ({ projectId, taskId }) => {
        const result = await mcpPublicationService.preparePublicationTask(projectId, taskId);
        return asToolResult(result);
    });

    server.registerTool('ba_confirm_publication', {
        description: 'Mark a publication task as published after a manual handoff or an external publish step.',
        inputSchema: {
            projectId: z.number().int().positive(),
            taskId: z.number().int().positive(),
            publishedLink: z.string().url(),
            note: z.string().optional(),
            outcome: z.enum(['published', 'blocked', 'removed', 'restricted']).optional()
        }
    }, async ({ projectId, taskId, publishedLink, note, outcome }) => {
        const task = await mcpPublicationService.confirmPublication(projectId, taskId, publishedLink, note, outcome);
        return asToolResult({ project_id: projectId, task });
    });

    server.registerTool('ba_publish_direct', {
        description: 'Publish content directly to a configured project channel. Supports reddit, telegram, vk, and linkedin.',
        inputSchema: {
            projectId: z.number().int().positive(),
            channelId: z.number().int().positive().optional(),
            channelType: z.enum(['reddit', 'telegram', 'vk', 'linkedin']).optional(),
            title: z.string().optional().describe('Required for reddit publication.'),
            text: z.string().min(1),
            subreddit: z.string().optional().describe('Required for reddit publication. Example: artificial or r/artificial'),
            imageUrl: z.string().optional().describe('Optional remote URL, data URI, or /uploads/... path supported by the channel adapter.'),
            dryRun: z.boolean().optional().describe('When true, validate channel resolution and preview the payload without publishing.')
        }
    }, async ({ projectId, channelId, channelType, title, text, subreddit, imageUrl, dryRun }) => {
        const result = await mcpPublicationService.publishDirect({
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

export async function shutdownMcpResources() {
    try {
        await prisma.$disconnect();
    } catch (_error) {
        // Ignore shutdown errors.
    }

    try {
        await pool.end();
    } catch (_error) {
        // Ignore shutdown errors.
    }
}
