"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsService = void 0;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const vk_service_1 = __importDefault(require("./vk.service"));
const linkedin_service_1 = __importDefault(require("./linkedin.service"));
const telegram_client_service_1 = __importDefault(require("./telegram_client.service"));
const reddit_service_1 = __importDefault(require("./reddit.service"));
const gsc_service_1 = __importDefault(require("./gsc.service"));
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class MetricsService {
    /**
     * Loops through all recently published posts and collects metrics from APIs.
     * We'll query posts published in the last 30 days to avoid fetching very old posts continuously.
     */
    async collectAllMetrics() {
        let updateCount = 0;
        try {
            console.log('[MetricsService] Starting metrics collection...');
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            // Find all published posts within the last 30 days that have an associated channel
            const posts = await prisma.post.findMany({
                where: {
                    status: 'published',
                    publish_at: {
                        gte: thirtyDaysAgo
                    },
                    channel_id: { not: null }
                },
                include: {
                    channel: true
                }
            });
            console.log(`[MetricsService] Found ${posts.length} published posts to fetch metrics for.`);
            for (const post of posts) {
                const channel = post.channel;
                if (!channel)
                    continue;
                let newMetrics = null;
                try {
                    if (channel.type === 'vk') {
                        const config = channel.config;
                        if (config.vk_id && config.api_key && post.published_link) {
                            // Extract post ID from published link e.g. https://vk.com/wall-1234_567 
                            const match = post.published_link.match(/wall-?\d+_(\d+)/);
                            if (match) {
                                newMetrics = await vk_service_1.default.getMetrics(config.vk_id, config.api_key, match[1]);
                            }
                        }
                    }
                    else if (channel.type === 'linkedin') {
                        const config = channel.config;
                        if (config.linkedin_urn && config.access_token && post.published_link) {
                            newMetrics = await linkedin_service_1.default.getMetrics(config.linkedin_urn, config.access_token, post.published_link);
                        }
                    }
                    else if (channel.type === 'telegram') {
                        // We need the telegram_message_id inside the post table
                        const msgId = post.telegram_message_id;
                        const config = channel.config;
                        if (msgId && config.telegram_channel_id) {
                            // Only mtproto client can fetch metrics
                            newMetrics = await telegram_client_service_1.default.getMetrics(post.project_id, config.telegram_channel_id, msgId);
                        }
                    }
                    if (newMetrics) {
                        await prisma.post.update({
                            where: { id: post.id },
                            data: { metrics: newMetrics }
                        });
                        updateCount++;
                        console.log(`[MetricsService] Updated metrics for post ${post.id} (${channel.type})`);
                    }
                }
                catch (innerErr) {
                    console.error(`[MetricsService] Failed to fetch metrics for post ${post.id}:`, innerErr);
                }
                // Sleep briefly to avoid API rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            const contentItems = await prisma.contentItem.findMany({
                where: {
                    status: 'published',
                    updated_at: {
                        gte: thirtyDaysAgo
                    },
                    channel_id: { not: null }
                },
                include: {
                    channel: true,
                    project: {
                        include: {
                            channels: true
                        }
                    }
                }
            });
            console.log(`[MetricsService] Found ${contentItems.length} publication tasks to fetch metrics for.`);
            for (const item of contentItems) {
                const channel = item.channel;
                if (!channel)
                    continue;
                let newMetrics = null;
                try {
                    if (channel.type === 'reddit' && item.published_link) {
                        newMetrics = await reddit_service_1.default.getPostMetrics(item.published_link);
                    }
                    else if (channel.type === 'google_search_console') {
                        const config = channel.config;
                        const targetUrl = item.published_link || item.metrics?.target_url || null;
                        if (targetUrl) {
                            const inspection = await gsc_service_1.default.inspectUrl(config.raw_account || config, targetUrl).catch(() => null);
                            const pageMetrics = await gsc_service_1.default.queryPageMetrics(config.raw_account || config, targetUrl).catch(() => null);
                            newMetrics = {
                                inspection,
                                pageMetrics
                            };
                        }
                    }
                    else if (channel.type === 'tilda') {
                        const gscChannel = item.project?.channels?.find((candidate) => candidate.type === 'google_search_console');
                        const targetUrl = item.published_link || item.metrics?.target_url || null;
                        if (gscChannel && targetUrl) {
                            newMetrics = await gsc_service_1.default.queryPageMetrics(gscChannel.config.raw_account || gscChannel.config, targetUrl).catch(() => null);
                        }
                    }
                    else if (channel.type === 'linkedin') {
                        const config = channel.config;
                        if (config.linkedin_urn && config.access_token && item.published_link) {
                            newMetrics = await linkedin_service_1.default.getMetrics(config.linkedin_urn, config.access_token, item.published_link).catch(() => null);
                        }
                    }
                    if (newMetrics) {
                        await prisma.contentItem.update({
                            where: { id: item.id },
                            data: {
                                metrics: {
                                    ...(item.metrics || {}),
                                    collected_metrics: newMetrics,
                                    metrics_updated_at: new Date().toISOString()
                                }
                            }
                        });
                        updateCount++;
                        console.log(`[MetricsService] Updated metrics for publication task ${item.id} (${channel.type})`);
                    }
                }
                catch (innerErr) {
                    console.error(`[MetricsService] Failed to fetch metrics for publication task ${item.id}:`, innerErr);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            console.log(`[MetricsService] Metrics collection finished. Updated ${updateCount} posts.`);
        }
        catch (err) {
            console.error('[MetricsService] Global Error during collection:', err);
        }
        return updateCount;
    }
}
exports.MetricsService = MetricsService;
exports.default = new MetricsService();
