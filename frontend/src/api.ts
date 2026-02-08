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

export const modelsApi = {
    fetch: (params: { provider?: string; keyId?: string; key?: string }) => {
        const query = new URLSearchParams(params as any).toString();
        return api.get(`/api/settings/models?${query}`);
    }
};

export const projectsApi = {
    update: (id: number, data: { name: string; description: string }) => api.put(`/api/projects/${id}`, data),
    addMember: (id: number, email: string, role: string) => api.post(`/api/projects/${id}/members`, { email, role }),
    removeMember: (id: number, userId: number) => api.delete(`/api/projects/${id}/members/${userId}`)
};
