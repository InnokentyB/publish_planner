"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class TildaService {
    getApiBase(config) {
        return config.api_base || process.env.TILDA_API_BASE || 'https://api.tildacdn.info/v1';
    }
    getKeys(config) {
        return {
            publickey: config.publickey || process.env.TILDA_PUBLIC_KEY || '',
            secretkey: config.secretkey || process.env.TILDA_SECRET_KEY || ''
        };
    }
    async getProjectInfo(config) {
        const { publickey, secretkey } = this.getKeys(config);
        const projectid = config.projectid || config.project_id || process.env.TILDA_PROJECT_ID || '';
        if (!publickey || !secretkey || !projectid) {
            throw new Error('Missing Tilda credentials or project ID');
        }
        const params = new URLSearchParams({
            publickey,
            secretkey,
            projectid
        });
        const response = await fetch(`${this.getApiBase(config)}/getprojectinfo/?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Tilda project info failed: ${await response.text()}`);
        }
        return response.json();
    }
    async executePublish(config, payload) {
        if (config.publish_webhook_url) {
            const response = await fetch(config.publish_webhook_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.publish_webhook_token ? { Authorization: `Bearer ${config.publish_webhook_token}` } : {})
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Tilda publish webhook failed: ${await response.text()}`);
            }
            return {
                mode: 'webhook',
                response: await response.json().catch(() => null)
            };
        }
        return {
            mode: 'manual_required',
            reason: 'Official Tilda API exposed in current docs is read/export oriented; no write publish endpoint is configured for this project.'
        };
    }
}
exports.default = new TildaService();
