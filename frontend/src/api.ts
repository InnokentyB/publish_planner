export interface ApiOptions extends RequestInit {
    body?: any;
}

const getHeaders = () => {
    const token = localStorage.getItem('token');
    const projectId = localStorage.getItem('projectId');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (projectId) {
        headers['x-project-id'] = projectId;
    }

    return headers;
};

export const api = {
    async request(endpoint: string, options: ApiOptions = {}) {
        const { body, ...customConfig } = options;
        const config: RequestInit = {
            ...customConfig,
            headers: {
                ...getHeaders(),
                ...customConfig.headers,
            },
        };

        if (body) {
            config.body = JSON.stringify(body);
        }

        const response = await fetch(endpoint, config);

        if (response.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'API Request Failed');
        }

        return response.json();
    },

    get(endpoint: string, options?: ApiOptions) {
        return this.request(endpoint, { ...options, method: 'GET' });
    },

    post(endpoint: string, body?: any, options?: ApiOptions) {
        return this.request(endpoint, { ...options, method: 'POST', body });
    },

    put(endpoint: string, body?: any, options?: ApiOptions) {
        return this.request(endpoint, { ...options, method: 'PUT', body });
    },

    delete(endpoint: string, options?: ApiOptions) {
        return this.request(endpoint, { ...options, method: 'DELETE' });
    },

    upload: (endpoint: string, file: File, options?: ApiOptions) => {
        const formData = new FormData();
        formData.append('file', file);

        // Custom config for file upload (don't set Content-Type header manually for FormData)
        const headers = getHeaders();
        delete headers['Content-Type'];

        return fetch(endpoint, {
            method: 'POST',
            body: formData,
            headers: {
                ...headers,
                ...(options?.headers || {})
            }
        }).then(async response => {
            if (response.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/login';
                throw new Error('Unauthorized');
            }
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Upload Failed');
            }
            return response.json();
        });
    }
};

export const commentsApi = {
    get: (entityType: string, entityId: number) =>
        api.get(`/api/comments?entityType=${entityType}&entityId=${entityId}`),
    create: (entityType: string, entityId: number, text: string) =>
        api.post('/api/comments', { entityType, entityId, text })
};

export const presetsApi = {
    getAll: () => api.get('/api/settings/presets'),
    create: (data: { name: string; role: string; prompt_text: string }) => api.post('/api/settings/presets', data),
    update: (id: number, data: Partial<{ name: string; role: string; prompt_text: string }>) => api.put(`/api/settings/presets/${id}`, data),
    delete: (id: number) => api.delete(`/api/settings/presets/${id}`)
};

export const keysApi = {
    getAll: () => api.get('/api/settings/keys'),
    create: (data: { name: string; key: string }) => api.post('/api/settings/keys', data),
    delete: (id: number) => api.delete(`/api/settings/keys/${id}`)
};

export const skillConnectionsApi = {
    getAll: () => api.get('/api/settings/skill-connections'),
    saveAll: (connections: any[]) => api.put('/api/settings/skill-connections', { connections })
};

export const contentDictionaryApi = {
    get: () => api.get('/api/settings/content-dictionary'),
    save: (yaml: string) => api.put('/api/settings/content-dictionary', { yaml }),
    validatePost: (postId: number, text: string) => api.post(`/api/posts/${postId}/validate-dictionary`, { text })
};

export const modelsApi = {
    fetch: (params: { provider?: string; keyId?: string; key?: string }) => {
        const query = new URLSearchParams(params as any).toString();
        return api.get(`/api/settings/models?${query}`);
    }
};

export const projectsApi = {
    create: (data: { name: string; slug?: string; description?: string }) => api.post('/api/projects', data),
    importConfig: (config: string) => api.post('/api/projects/import', { config }),
    importPublicationPlan: (planJson: string) => api.post('/api/projects/import-publication-plan', { planJson }),
    update: (id: number, data: { name: string; description: string }) => api.put(`/api/projects/${id}`, data),
    addMember: (id: number, email: string, role: string) => api.post(`/api/projects/${id}/members`, { email, role }),
    removeMember: (id: number, userId: number) => api.delete(`/api/projects/${id}/members/${userId}`)
};

export const publicationTasksApi = {
    list: (params?: { status?: string; manualOnly?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.manualOnly) query.set('manualOnly', 'true');
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return api.get(`/api/publication-tasks${suffix}`);
    },
    get: (id: number) => api.get(`/api/publication-tasks/${id}`),
    prepareHandoff: (id: number) => api.post(`/api/publication-tasks/${id}/prepare-handoff`),
    confirmPublication: (id: number, data: { publishedLink: string; note?: string }) =>
        api.post(`/api/publication-tasks/${id}/confirm-publication`, data),
    recordMetrics: (id: number, metrics: Record<string, any>) =>
        api.post(`/api/publication-tasks/${id}/record-metrics`, { metrics }),
    externalCommentAlert: (id: number, data: { text?: string; commentUrl?: string; author?: string }) =>
        api.post(`/api/publication-tasks/${id}/external-comment-alert`, data)
};
