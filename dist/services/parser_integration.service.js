"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const db_1 = __importDefault(require("../db"));
const auth_service_1 = __importDefault(require("./auth.service"));
const parser_client_1 = __importDefault(require("./parser_client"));
const schema_plan_service_1 = __importDefault(require("./schema_plan.service"));
function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
class ParserIntegrationService {
    async getHealth() {
        return {
            parser: await parser_client_1.default.health(),
            schema_plan: schema_plan_service_1.default.getPlan()
        };
    }
    async createSearchJob(params, actor) {
        const context = await this.requireProjectContext(params.projectId, actor);
        const result = await parser_client_1.default.createSearchJob(params);
        await this.logEvent(context.projectId, 'planner.parser_job_create', {
            user_id: actor.userId,
            workspace_id: context.workspaceId,
            job_id: result.job_id,
            run_id: result.run_id,
            query: params.query,
            source: params.source || 'reddit'
        });
        await this.storeSnapshot(context, 'job_created', {
            job_id: result.job_id,
            run_id: result.run_id,
            query: params.query,
            source: params.source || 'reddit',
            response: result
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async getSearchJob(projectId, jobId, actor) {
        const context = await this.requireProjectContext(projectId, actor);
        const result = await parser_client_1.default.getSearchJob(projectId, jobId);
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async refreshSearchJob(params, actor) {
        const context = await this.requireProjectContext(params.projectId, actor, 'editor');
        const result = await parser_client_1.default.refreshSearchJob(params);
        await this.logEvent(context.projectId, 'planner.parser_job_refresh', {
            user_id: actor.userId,
            workspace_id: context.workspaceId,
            job_id: params.jobId,
            run_id: result.run_id
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async listPosts(projectId, actor, options = {}) {
        const context = await this.requireProjectContext(projectId, actor);
        const result = await parser_client_1.default.listPosts({
            projectId,
            limit: options.limit,
            offset: options.offset
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async getInsights(params, actor) {
        const context = await this.requireProjectContext(params.projectId, actor);
        const result = await parser_client_1.default.getInsights(params);
        await this.storeSnapshot(context, 'insights_sync', {
            filters: compactObject({
                limit: params.limit,
                offset: params.offset,
                job_id: params.jobId,
                type: params.type
            }),
            groups: result?.groups || {},
            returned: result?.pagination?.returned ?? result?.data?.length ?? 0
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async getSummary(params, actor) {
        const context = await this.requireProjectContext(params.projectId, actor);
        const result = await parser_client_1.default.getSummary(params);
        await this.storeSnapshot(context, 'job_summary', {
            job_id: params.jobId,
            status: result?.status,
            generated_from_posts: result?.generated_from_posts,
            groups: result?.groups || {}
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async listTemplates(projectId, actor) {
        const context = await this.requireProjectContext(projectId, actor);
        const result = await parser_client_1.default.listTemplates(projectId);
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async importTemplates(params, actor) {
        const context = await this.requireProjectContext(params.projectId, actor, 'editor');
        const result = await parser_client_1.default.importTemplates(params);
        await this.logEvent(context.projectId, 'planner.parser_templates_import', {
            user_id: actor.userId,
            workspace_id: context.workspaceId,
            imported_templates: result?.imported_templates ?? 0
        });
        await this.storeSnapshot(context, 'templates_imported', {
            imported_templates: result?.imported_templates ?? 0,
            response: result
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async runTemplate(params, actor) {
        const context = await this.requireProjectContext(params.projectId, actor, 'editor');
        const result = await parser_client_1.default.runTemplate(params);
        await this.logEvent(context.projectId, 'planner.parser_template_run', {
            user_id: actor.userId,
            workspace_id: context.workspaceId,
            template_id: params.templateId,
            job_id: result?.job_id,
            run_id: result?.run_id
        });
        await this.storeSnapshot(context, 'template_run', {
            template_id: params.templateId,
            response: result
        });
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }
    async requireProjectContext(projectId, actor, minRole = 'viewer') {
        const requiredRole = this.resolveRequiredRole(actor.minRole, minRole);
        const hasAccess = await auth_service_1.default.hasProjectAccess(actor.userId, projectId, requiredRole);
        if (!hasAccess) {
            throw new Error(`User ${actor.userId} does not have ${requiredRole} access to project ${projectId}`);
        }
        const project = await db_1.default.project.findUnique({
            where: { id: projectId },
            select: {
                id: true,
                name: true,
                slug: true,
                description: true
            }
        });
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }
        return {
            projectId,
            workspaceId: schema_plan_service_1.default.getParserWorkspaceId(projectId),
            project
        };
    }
    async logEvent(projectId, eventType, payload) {
        await db_1.default.event.create({
            data: {
                entity_type: 'project',
                entity_id: projectId,
                event_type: eventType,
                payload
            }
        });
    }
    resolveRequiredRole(actorRole, baseRole) {
        const roleOrder = ['viewer', 'editor', 'owner'];
        if (!actorRole) {
            return baseRole;
        }
        return roleOrder.indexOf(actorRole) > roleOrder.indexOf(baseRole) ? actorRole : baseRole;
    }
    async storeSnapshot(context, kind, payload) {
        const key = `parser_snapshot:${kind}:${(0, crypto_1.randomUUID)()}`;
        await db_1.default.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: context.projectId,
                    key
                }
            },
            update: {
                value: JSON.stringify({
                    workspace_id: context.workspaceId,
                    captured_at: new Date().toISOString(),
                    payload
                })
            },
            create: {
                project_id: context.projectId,
                key,
                value: JSON.stringify({
                    workspace_id: context.workspaceId,
                    captured_at: new Date().toISOString(),
                    payload
                })
            }
        });
    }
}
exports.default = new ParserIntegrationService();
