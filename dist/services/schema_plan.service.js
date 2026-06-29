"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildParserWorkspaceId = buildParserWorkspaceId;
exports.getDatabaseSchemaPlan = getDatabaseSchemaPlan;
require("../bootstrap-env");
function normalizeSchemaName(value, fallback) {
    const normalized = (value || fallback).trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(normalized)) {
        throw new Error(`Invalid Postgres schema name: '${value}'`);
    }
    return normalized;
}
function detectStage(runtimePlannerSchema, targetPlannerSchema, parserSchema) {
    if (runtimePlannerSchema === targetPlannerSchema && runtimePlannerSchema === 'planner' && parserSchema === 'parser') {
        return 'target_dual_schema';
    }
    if (runtimePlannerSchema === 'public' && targetPlannerSchema === 'planner' && parserSchema === 'parser') {
        return 'dual_schema_transition';
    }
    return 'current_public_runtime';
}
function buildParserWorkspaceId(projectId) {
    return `project:${projectId}`;
}
function getDatabaseSchemaPlan() {
    const runtimePlannerSchema = normalizeSchemaName(process.env.APP_DB_SCHEMA || process.env.PLANNER_DB_SCHEMA, 'planner');
    const runtimeParserSchema = normalizeSchemaName(process.env.PARSER_DB_SCHEMA, 'parser');
    const targetPlannerSchema = normalizeSchemaName(process.env.APP_TARGET_DB_SCHEMA || process.env.PLANNER_TARGET_SCHEMA || process.env.APP_DB_SCHEMA, 'planner');
    const targetParserSchema = normalizeSchemaName(process.env.PARSER_TARGET_SCHEMA, runtimeParserSchema);
    return {
        runtime: {
            planner_schema: runtimePlannerSchema,
            parser_schema: runtimeParserSchema
        },
        target: {
            planner_schema: targetPlannerSchema,
            parser_schema: targetParserSchema
        },
        stage: detectStage(runtimePlannerSchema, targetPlannerSchema, runtimeParserSchema),
        workspace_mapping: {
            format: 'project:{projectId}',
            example: buildParserWorkspaceId(42)
        },
        migration_policy: {
            planner_repo_writes_to: targetPlannerSchema,
            parser_repo_writes_to: targetParserSchema,
            allow_runtime_public_reads: runtimePlannerSchema === 'public'
        }
    };
}
class SchemaPlanService {
    getPlan() {
        return getDatabaseSchemaPlan();
    }
    getPlannerRuntimeSchema() {
        return this.getPlan().runtime.planner_schema;
    }
    getPlannerTargetSchema() {
        return this.getPlan().target.planner_schema;
    }
    getParserRuntimeSchema() {
        return this.getPlan().runtime.parser_schema;
    }
    getParserTargetSchema() {
        return this.getPlan().target.parser_schema;
    }
    getParserWorkspaceId(projectId) {
        return buildParserWorkspaceId(projectId);
    }
}
exports.default = new SchemaPlanService();
