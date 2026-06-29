"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserClient = void 0;
require("../bootstrap-env");
const crypto_1 = require("crypto");
const schema_plan_service_1 = __importDefault(require("./schema_plan.service"));
function requireBaseUrl(baseUrl) {
    if (!baseUrl) {
        throw new Error('PARSER_API_BASE_URL is not configured');
    }
    return baseUrl.replace(/\/+$/, '');
}
function buildQueryString(query) {
    const params = new URLSearchParams();
    if (!query) {
        return '';
    }
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}
async function readJsonSafely(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
class ParserClient {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || process.env.PARSER_API_BASE_URL;
        this.serviceToken = options.serviceToken || process.env.PARSER_SERVICE_TOKEN;
        this.timeoutMs = options.timeoutMs || Number(process.env.PARSER_REQUEST_TIMEOUT_MS || 15000);
    }
    getWorkspaceId(projectId) {
        return schema_plan_service_1.default.getParserWorkspaceId(projectId);
    }
    async health() {
        return this.request('GET', '/health');
    }
    async createSearchJob(input) {
        return this.request('POST', '/search', {
            workspaceId: this.getWorkspaceId(input.projectId),
            body: {
                source: input.source || 'reddit',
                query: input.query,
                subreddit: input.subreddit,
                subreddits: input.subreddits,
                id: input.queryDefinitionId,
                intent: input.intent,
                cluster: input.cluster,
                priority: input.priority,
                match_must_include_any: input.matchMustIncludeAny,
                exclude_if_contains: input.excludeIfContains,
                exclude_regexes: input.excludeRegexes,
                limit: input.limit ?? 25,
                min_score: input.minScore ?? 0,
                date_from: input.dateFrom,
                date_to: input.dateTo,
                include_comments: input.includeComments ?? true,
                enrich: input.enrich ?? true,
                idempotency_key: input.idempotencyKey || (0, crypto_1.randomUUID)()
            }
        });
    }
    async getSearchJob(projectId, jobId) {
        return this.request('GET', `/search/${encodeURIComponent(jobId)}`, {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }
    async refreshSearchJob(input) {
        return this.request('POST', `/refresh/${encodeURIComponent(input.jobId)}`, {
            workspaceId: this.getWorkspaceId(input.projectId),
            body: {
                idempotency_key: input.idempotencyKey || (0, crypto_1.randomUUID)()
            }
        });
    }
    async listPosts(params) {
        return this.request('GET', '/posts', {
            workspaceId: this.getWorkspaceId(params.projectId),
            query: {
                limit: params.limit ?? 25,
                offset: params.offset ?? 0
            }
        });
    }
    async getPost(projectId, redditPostId) {
        return this.request('GET', `/posts/${encodeURIComponent(redditPostId)}`, {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }
    async getInsights(params) {
        return this.request('GET', '/insights', {
            workspaceId: this.getWorkspaceId(params.projectId),
            query: {
                limit: params.limit ?? 25,
                offset: params.offset ?? 0,
                job_id: params.jobId,
                type: params.type
            }
        });
    }
    async getSummary(params) {
        return this.request('GET', `/summaries/${encodeURIComponent(params.jobId)}`, {
            workspaceId: this.getWorkspaceId(params.projectId)
        });
    }
    async listTemplates(projectId) {
        return this.request('GET', '/search-templates', {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }
    async getTemplate(projectId, templateId) {
        return this.request('GET', `/search-templates/${encodeURIComponent(templateId)}`, {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }
    async importTemplates(input) {
        return this.request('POST', '/search-templates/import', {
            workspaceId: this.getWorkspaceId(input.projectId),
            body: {
                yaml_content: input.yamlContent,
                query_bank: input.queryBank,
                schedule_daily: input.scheduleDaily ?? true,
                limit: input.limit ?? 50,
                min_score: input.minScore ?? 0,
                date_from: input.dateFrom,
                date_to: input.dateTo,
                include_comments: input.includeComments ?? true,
                enrich: input.enrich ?? true,
                idempotency_key: input.idempotencyKey || (0, crypto_1.randomUUID)()
            }
        });
    }
    async runTemplate(input) {
        return this.request('POST', `/search-templates/${encodeURIComponent(input.templateId)}/run`, {
            workspaceId: this.getWorkspaceId(input.projectId),
            body: {
                idempotency_key: input.idempotencyKey || (0, crypto_1.randomUUID)()
            }
        });
    }
    async request(method, pathname, options = {}) {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs || this.timeoutMs;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const headers = {
            Accept: 'application/json',
            ...options.headers
        };
        if (options.workspaceId) {
            headers['X-Workspace-Id'] = options.workspaceId;
        }
        if (this.serviceToken) {
            headers.Authorization = `Bearer ${this.serviceToken}`;
        }
        let body;
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.body);
        }
        const url = `${requireBaseUrl(this.baseUrl)}${pathname}${buildQueryString(options.query)}`;
        try {
            const response = await fetch(url, {
                method,
                headers,
                body,
                signal: controller.signal
            });
            const payload = await readJsonSafely(response);
            if (!response.ok) {
                throw new Error(`Parser API ${method} ${pathname} failed with ${response.status}: ${JSON.stringify(payload)}`);
            }
            return payload;
        }
        catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error(`Parser API ${method} ${pathname} timed out after ${timeoutMs}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.ParserClient = ParserClient;
exports.default = new ParserClient();
