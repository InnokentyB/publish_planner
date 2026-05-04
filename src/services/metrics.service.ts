import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import vkService from './vk.service';
import linkedinService from './linkedin.service';
import telegramClientService from './telegram_client.service';
import redditService from './reddit.service';
import gscService from './gsc.service';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class MetricsService {
    private async fetchPublicationTaskMetrics(item: any): Promise<{ metrics: any | null; reason?: string }> {
        const channel = item.channel;
        if (!channel) {
            return { metrics: null, reason: 'Task has no connected channel.' };
        }

        if (!item.published_link && channel.type !== 'google_search_console') {
            return { metrics: null, reason: 'Task has no published URL yet.' };
        }

        if (channel.type === 'reddit' && item.published_link) {
            const redditMetrics = await redditService.getPostMetrics(item.published_link);
            return {
                metrics: {
                    ...redditMetrics,
                    publication_outcome: (item.metrics as any)?.publication_outcome || (item.quality_report as any)?.publication_outcome || 'published'
                },
                reason: redditMetrics?.unavailable
                    ? 'Reddit post URL was saved, but live metrics are unavailable for this link right now. The task remains confirmed.'
                    : undefined
            };
        }

        if (channel.type === 'google_search_console') {
            const config: any = channel.config;
            const targetUrl = item.published_link || (item.metrics as any)?.target_url || null;
            if (!targetUrl) {
                return { metrics: null, reason: 'No target URL is available for GSC metrics.' };
            }

            const inspection = await gscService.inspectUrl(config.raw_account || config, targetUrl).catch(() => null);
            const pageMetrics = await gscService.queryPageMetrics(config.raw_account || config, targetUrl).catch(() => null);
            return {
                metrics: {
                    inspection,
                    pageMetrics
                }
            };
        }

        if (channel.type === 'tilda') {
            const gscChannel = item.project?.channels?.find((candidate: any) => candidate.type === 'google_search_console');
            const targetUrl = item.published_link || (item.metrics as any)?.target_url || null;
            if (!gscChannel || !targetUrl) {
                return { metrics: null, reason: 'Tilda metrics require a linked Google Search Console channel and a live URL.' };
            }

            return {
                metrics: await gscService.queryPageMetrics((gscChannel.config as any).raw_account || gscChannel.config, targetUrl).catch(() => null),
                reason: 'Metrics were derived from the linked Google Search Console channel.'
            };
        }

        if (channel.type === 'linkedin') {
            const config: any = channel.config;
            if (!config.linkedin_urn || !config.access_token || !item.published_link) {
                return { metrics: null, reason: 'LinkedIn channel is missing `linkedin_urn`, `access_token`, or the post URL.' };
            }

            const linkedinMetrics = await linkedinService.getMetrics(config.linkedin_urn, config.access_token, item.published_link).catch(() => null);
            if (!linkedinMetrics) {
                return { metrics: null, reason: 'LinkedIn API did not return metrics for this post.' };
            }

            return {
                metrics: {
                    ...linkedinMetrics,
                    reconnect_required: config.analytics_scope_enabled !== true,
                    reconnect_note: config.analytics_scope_enabled === true
                        ? null
                        : 'Reconnect the LinkedIn channel after Community Management approval so the token includes `r_member_postAnalytics`.'
                }
            };
        }

        return { metrics: null, reason: `Automatic metrics are not implemented for channel type \`${channel.type}\`.` };
    }

    async collectMetricsForContentItem(itemId: number, projectId?: number) {
        const item = await prisma.contentItem.findFirst({
            where: {
                id: itemId,
                ...(projectId ? { project_id: projectId } : {})
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

        if (!item) {
            return { found: false, updated: false, reason: 'Publication task not found.' };
        }

        const result = await this.fetchPublicationTaskMetrics(item);
        if (!result.metrics) {
            return {
                found: true,
                updated: false,
                reason: result.reason || 'No metrics were collected.',
                metrics: (item.metrics as any)?.collected_metrics || null
            };
        }

        const mergedMetrics = {
            ...((item.metrics as any) || {}),
            collected_metrics: result.metrics,
            metrics_updated_at: new Date().toISOString()
        } as any;

        await prisma.contentItem.update({
            where: { id: item.id },
            data: { metrics: mergedMetrics }
        });

        return {
            found: true,
            updated: true,
            reason: result.reason || null,
            metrics: result.metrics
        };
    }

    /**
     * Loops through all recently published posts and collects metrics from APIs.
     * We'll query posts published in the last 30 days to avoid fetching very old posts continuously.
     */
    async collectAllMetrics(): Promise<number> {
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
                if (!channel) continue;

                let newMetrics: any = null;

                try {
                    if (channel.type === 'vk') {
                        const config: any = channel.config;
                        if (config.vk_id && config.api_key && post.published_link) {
                            // Extract post ID from published link e.g. https://vk.com/wall-1234_567 
                            const match = post.published_link.match(/wall-?\d+_(\d+)/);
                            if (match) {
                                newMetrics = await vkService.getMetrics(config.vk_id, config.api_key, match[1]);
                            }
                        }
                    } else if (channel.type === 'linkedin') {
                        const config: any = channel.config;
                        if (config.linkedin_urn && config.access_token && post.published_link) {
                            newMetrics = await linkedinService.getMetrics(config.linkedin_urn, config.access_token, post.published_link);
                        }
                    } else if (channel.type === 'telegram') {
                        // We need the telegram_message_id inside the post table
                        const msgId = post.telegram_message_id;
                        const config: any = channel.config;
                        if (msgId && config.telegram_channel_id) {
                            // Only mtproto client can fetch metrics
                            newMetrics = await telegramClientService.getMetrics(post.project_id, config.telegram_channel_id, msgId);
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
                } catch (innerErr) {
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
                try {
                    const result = await this.fetchPublicationTaskMetrics(item);
                    const newMetrics = result.metrics;

                    if (newMetrics) {
                        await prisma.contentItem.update({
                            where: { id: item.id },
                            data: {
                                metrics: {
                                    ...((item.metrics as any) || {}),
                                    collected_metrics: newMetrics,
                                    metrics_updated_at: new Date().toISOString()
                                } as any
                            }
                        });
                        updateCount++;
                        console.log(`[MetricsService] Updated metrics for publication task ${item.id} (${item.channel?.type})`);
                    }
                } catch (innerErr) {
                    console.error(`[MetricsService] Failed to fetch metrics for publication task ${item.id}:`, innerErr);
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log(`[MetricsService] Metrics collection finished. Updated ${updateCount} posts.`);
        } catch (err) {
            console.error('[MetricsService] Global Error during collection:', err);
        }

        return updateCount;
    }
}

export default new MetricsService();
