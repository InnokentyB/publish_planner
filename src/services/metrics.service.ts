import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import vkService from './vk.service';
import linkedinService from './linkedin.service';
import telegramClientService from './telegram_client.service';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class MetricsService {
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
                    status: 'PUBLISHED',
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

            console.log(`[MetricsService] Metrics collection finished. Updated ${updateCount} posts.`);
        } catch (err) {
            console.error('[MetricsService] Global Error during collection:', err);
        }

        return updateCount;
    }
}

export default new MetricsService();
