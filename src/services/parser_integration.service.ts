import { randomUUID } from 'crypto';
import prisma from '../db';
import authService from './auth.service';
import parserClient, {
    ParserInsightsQuery,
    ParserRefreshJobRequest,
    ParserSearchJobRequest,
    ParserSummaryQuery,
    ParserTemplateImportRequest,
    ParserRunTemplateRequest
} from './parser_client';
import schemaPlanService from './schema_plan.service';

type ProjectActor = {
    userId: number;
    minRole?: 'owner' | 'editor' | 'viewer';
};

type ParserSnapshotKind = 'job_created' | 'job_summary' | 'templates_imported' | 'template_run' | 'insights_sync';

type ParserProjectContext = {
    projectId: number;
    workspaceId: string;
    project: {
        id: number;
        name: string;
        slug: string;
        description: string | null;
    };
};

function compactObject<T extends Record<string, any>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined)
    ) as T;
}

class ParserIntegrationService {
    async getHealth() {
        return {
            parser: await parserClient.health(),
            schema_plan: schemaPlanService.getPlan()
        };
    }

    async createSearchJob(params: ParserSearchJobRequest, actor: ProjectActor) {
        const context = await this.requireProjectContext(params.projectId, actor);
        const result = await parserClient.createSearchJob(params);

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

    async getSearchJob(projectId: number, jobId: string, actor: ProjectActor) {
        const context = await this.requireProjectContext(projectId, actor);
        const result = await parserClient.getSearchJob(projectId, jobId);
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }

    async refreshSearchJob(params: ParserRefreshJobRequest, actor: ProjectActor) {
        const context = await this.requireProjectContext(params.projectId, actor, 'editor');
        const result = await parserClient.refreshSearchJob(params);

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

    async listPosts(projectId: number, actor: ProjectActor, options: { limit?: number; offset?: number } = {}) {
        const context = await this.requireProjectContext(projectId, actor);
        const result = await parserClient.listPosts({
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

    async getInsights(params: ParserInsightsQuery, actor: ProjectActor) {
        const context = await this.requireProjectContext(params.projectId, actor);
        const result = await parserClient.getInsights(params);

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

    async getSummary(params: ParserSummaryQuery, actor: ProjectActor) {
        const context = await this.requireProjectContext(params.projectId, actor);
        const result = await parserClient.getSummary(params);

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

    async listTemplates(projectId: number, actor: ProjectActor) {
        const context = await this.requireProjectContext(projectId, actor);
        const result = await parserClient.listTemplates(projectId);
        return {
            project: context.project,
            workspace_id: context.workspaceId,
            parser_response: result
        };
    }

    async importTemplates(params: ParserTemplateImportRequest, actor: ProjectActor) {
        const context = await this.requireProjectContext(params.projectId, actor, 'editor');
        const result = await parserClient.importTemplates(params);

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

    async runTemplate(params: ParserRunTemplateRequest, actor: ProjectActor) {
        const context = await this.requireProjectContext(params.projectId, actor, 'editor');
        const result = await parserClient.runTemplate(params);

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

    private async requireProjectContext(projectId: number, actor: ProjectActor, minRole: 'owner' | 'editor' | 'viewer' = 'viewer'): Promise<ParserProjectContext> {
        const requiredRole = this.resolveRequiredRole(actor.minRole, minRole);
        const hasAccess = await authService.hasProjectAccess(actor.userId, projectId, requiredRole);
        if (!hasAccess) {
            throw new Error(`User ${actor.userId} does not have ${requiredRole} access to project ${projectId}`);
        }

        const project = await prisma.project.findUnique({
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
            workspaceId: schemaPlanService.getParserWorkspaceId(projectId),
            project
        };
    }

    private async logEvent(projectId: number, eventType: string, payload: Record<string, any>) {
        await prisma.event.create({
            data: {
                entity_type: 'project',
                entity_id: projectId,
                event_type: eventType,
                payload
            }
        });
    }

    private resolveRequiredRole(actorRole: ProjectActor['minRole'], baseRole: 'owner' | 'editor' | 'viewer') {
        const roleOrder = ['viewer', 'editor', 'owner'];
        if (!actorRole) {
            return baseRole;
        }

        return roleOrder.indexOf(actorRole) > roleOrder.indexOf(baseRole) ? actorRole : baseRole;
    }

    private async storeSnapshot(context: ParserProjectContext, kind: ParserSnapshotKind, payload: Record<string, any>) {
        const key = `parser_snapshot:${kind}:${randomUUID()}`;
        await prisma.projectSettings.upsert({
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

export default new ParserIntegrationService();
