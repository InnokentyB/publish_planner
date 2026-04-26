"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class GscService {
    getAccessToken(config) {
        return config.access_token || process.env.GSC_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || '';
    }
    getSiteUrl(config) {
        return config.site_url || config.property || process.env.GSC_SITE_URL || '';
    }
    async inspectUrl(config, inspectionUrl) {
        const accessToken = this.getAccessToken(config);
        const siteUrl = this.getSiteUrl(config);
        if (!accessToken || !siteUrl) {
            throw new Error('Missing GSC access token or site URL');
        }
        const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inspectionUrl,
                siteUrl
            })
        });
        if (!response.ok) {
            throw new Error(`GSC URL inspection failed: ${await response.text()}`);
        }
        return response.json();
    }
    async queryPageMetrics(config, pageUrl, days = 28) {
        const accessToken = this.getAccessToken(config);
        const siteUrl = this.getSiteUrl(config);
        if (!accessToken || !siteUrl) {
            throw new Error('Missing GSC access token or site URL');
        }
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);
        const encodedSiteUrl = encodeURIComponent(siteUrl);
        const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                startDate: startDate.toISOString().slice(0, 10),
                endDate: endDate.toISOString().slice(0, 10),
                dimensions: ['page'],
                dimensionFilterGroups: [
                    {
                        filters: [
                            {
                                dimension: 'page',
                                operator: 'equals',
                                expression: pageUrl
                            }
                        ]
                    }
                ],
                rowLimit: 1
            })
        });
        if (!response.ok) {
            throw new Error(`GSC search analytics failed: ${await response.text()}`);
        }
        const data = await response.json();
        const row = data?.rows?.[0];
        return {
            clicks: row?.clicks || 0,
            impressions: row?.impressions || 0,
            ctr: row?.ctr || 0,
            position: row?.position || null,
            retrieved_at: new Date().toISOString()
        };
    }
}
exports.default = new GscService();
