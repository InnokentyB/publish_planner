import '../bootstrap-env';
import { randomUUID } from 'crypto';
import schemaPlanService from './schema_plan.service';

type HttpMethod = 'GET' | 'POST';

type ParserClientOptions = {
    baseUrl?: string;
    serviceToken?: string;
    timeoutMs?: number;
};

type ParserRequestOptions = {
    workspaceId?: string;
    query?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
};

export type ParserSearchJobRequest = {
    projectId: number;
    source?: 'reddit' | 'indie_hackers';
    query: string;
    subreddit?: string;
    subreddits?: string[];
    queryDefinitionId?: string;
    intent?: string;
    cluster?: string;
    priority?: number;
    matchMustIncludeAny?: string[];
    excludeIfContains?: string[];
    excludeRegexes?: string[];
    limit?: number;
    minScore?: number;
    dateFrom?: string;
    dateTo?: string;
    includeComments?: boolean;
    enrich?: boolean;
    idempotencyKey?: string;
};

export type ParserTemplateImportRequest = {
    projectId: number;
    yamlContent?: string;
    queryBank?: Record<string, any>;
    scheduleDaily?: boolean;
    limit?: number;
    minScore?: number;
    dateFrom?: string;
    dateTo?: string;
    includeComments?: boolean;
    enrich?: boolean;
    idempotencyKey?: string;
};

export type ParserRunTemplateRequest = {
    projectId: number;
    templateId: string;
    idempotencyKey?: string;
};

export type ParserRefreshJobRequest = {
    projectId: number;
    jobId: string;
    idempotencyKey?: string;
};

export type ParserListPostsQuery = {
    projectId: number;
    limit?: number;
    offset?: number;
};

export type ParserInsightsQuery = {
    projectId: number;
    limit?: number;
    offset?: number;
    jobId?: string;
    type?: string;
};

export type ParserSummaryQuery = {
    projectId: number;
    jobId: string;
};

function requireBaseUrl(baseUrl?: string) {
    if (!baseUrl) {
        throw new Error('PARSER_API_BASE_URL is not configured');
    }

    return baseUrl.replace(/\/+$/, '');
}

function buildQueryString(query?: ParserRequestOptions['query']) {
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

async function readJsonSafely(response: Response) {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

class ParserClient {
    private readonly baseUrl?: string;
    private readonly serviceToken?: string;
    private readonly timeoutMs: number;

    constructor(options: ParserClientOptions = {}) {
        this.baseUrl = options.baseUrl || process.env.PARSER_API_BASE_URL;
        this.serviceToken = options.serviceToken || process.env.PARSER_SERVICE_TOKEN;
        this.timeoutMs = options.timeoutMs || Number(process.env.PARSER_REQUEST_TIMEOUT_MS || 15000);
    }

    getWorkspaceId(projectId: number) {
        return schemaPlanService.getParserWorkspaceId(projectId);
    }

    async health() {
        return this.request<any>('GET', '/health');
    }

    async createSearchJob(input: ParserSearchJobRequest) {
        return this.request<any>('POST', '/search', {
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
                idempotency_key: input.idempotencyKey || randomUUID()
            }
        });
    }

    async getSearchJob(projectId: number, jobId: string) {
        return this.request<any>('GET', `/search/${encodeURIComponent(jobId)}`, {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }

    async refreshSearchJob(input: ParserRefreshJobRequest) {
        return this.request<any>('POST', `/refresh/${encodeURIComponent(input.jobId)}`, {
            workspaceId: this.getWorkspaceId(input.projectId),
            body: {
                idempotency_key: input.idempotencyKey || randomUUID()
            }
        });
    }

    async listPosts(params: ParserListPostsQuery) {
        return this.request<any>('GET', '/posts', {
            workspaceId: this.getWorkspaceId(params.projectId),
            query: {
                limit: params.limit ?? 25,
                offset: params.offset ?? 0
            }
        });
    }

    async getPost(projectId: number, redditPostId: string) {
        return this.request<any>('GET', `/posts/${encodeURIComponent(redditPostId)}`, {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }

    async getInsights(params: ParserInsightsQuery) {
        return this.request<any>('GET', '/insights', {
            workspaceId: this.getWorkspaceId(params.projectId),
            query: {
                limit: params.limit ?? 25,
                offset: params.offset ?? 0,
                job_id: params.jobId,
                type: params.type
            }
        });
    }

    async getSummary(params: ParserSummaryQuery) {
        return this.request<any>('GET', `/summaries/${encodeURIComponent(params.jobId)}`, {
            workspaceId: this.getWorkspaceId(params.projectId)
        });
    }

    async listTemplates(projectId: number) {
        return this.request<any>('GET', '/search-templates', {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }

    async getTemplate(projectId: number, templateId: string) {
        return this.request<any>('GET', `/search-templates/${encodeURIComponent(templateId)}`, {
            workspaceId: this.getWorkspaceId(projectId)
        });
    }

    async importTemplates(input: ParserTemplateImportRequest) {
        return this.request<any>('POST', '/search-templates/import', {
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
                idempotency_key: input.idempotencyKey || randomUUID()
            }
        });
    }

    async runTemplate(input: ParserRunTemplateRequest) {
        return this.request<any>('POST', `/search-templates/${encodeURIComponent(input.templateId)}/run`, {
            workspaceId: this.getWorkspaceId(input.projectId),
            body: {
                idempotency_key: input.idempotencyKey || randomUUID()
            }
        });
    }

    private async request<T>(method: HttpMethod, pathname: string, options: ParserRequestOptions = {}): Promise<T> {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs || this.timeoutMs;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...options.headers
        };

        if (options.workspaceId) {
            headers['X-Workspace-Id'] = options.workspaceId;
        }

        if (this.serviceToken) {
            headers.Authorization = `Bearer ${this.serviceToken}`;
        }

        let body: string | undefined;
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

            return payload as T;
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw new Error(`Parser API ${method} ${pathname} timed out after ${timeoutMs}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
}

export { ParserClient };

export default new ParserClient();
