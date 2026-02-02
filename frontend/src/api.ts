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
