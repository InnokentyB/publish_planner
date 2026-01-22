import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import telegramService from './telegram.service';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class PublisherService {
    async publishDuePosts() {
        const now = new Date();

        // Find all scheduled posts that are due
        const duePosts = await prisma.post.findMany({
            where: {
                status: {
                    in: ['scheduled', 'scheduled_native'] // Include both, though scheduled_native are handled by Telegram
                },
                publish_at: { lte: now }
            },
            include: {
                week: true
            }
        });

        console.log(`Found ${duePosts.length} posts due (or past due) for publishing.`);

        for (const post of duePosts) {
            // Skip if it was native scheduled and we assume Telegram handled it
            // But if we want to support "manual" publishing of missed native posts, we might need check.
            // For now, let's assume 'scheduled' means "waiting for bot to publish".
            if (post.status === 'scheduled_native') continue;

            try {
                // Get the channel for this post
                const channel = await prisma.channel.findUnique({
                    where: { id: post.channel_id }
                });

                if (!channel || !channel.telegram_channel_id) {
                    console.error(`Channel not found or telegram_channel_id missing for post ${post.id}`);
                    continue;
                }

                const targetChannelId = channel.telegram_channel_id.toString();
                const text = post.final_text || post.generated_text || '';

                if (post.image_url) {
                    let photoSource: any = post.image_url;
                    if (post.image_url.startsWith('data:')) {
                        const base64Data = post.image_url.split(',')[1];
                        photoSource = { source: Buffer.from(base64Data, 'base64') };
                    }

                    // Check length for caption (limit 1024)
                    if (text.length > 1024) {
                        // Send photo with title/topic only
                        await telegramService.sendPhoto(targetChannelId, photoSource, {
                            caption: post.topic ? `**${post.topic}**` : '',
                            parse_mode: 'Markdown'
                        });
                        // Send full text as separate message
                        await telegramService.sendMessage(targetChannelId, text, {
                            parse_mode: 'Markdown'
                        });
                    } else {
                        await telegramService.sendPhoto(targetChannelId, photoSource, {
                            caption: text,
                            parse_mode: 'Markdown'
                        });
                    }
                } else {
                    await telegramService.sendMessage(targetChannelId, text, {
                        parse_mode: 'Markdown'
                    });
                }

                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'published' }
                });

                console.log(`Successfully published post ${post.id} to channel ${targetChannelId}`);
            } catch (err) {
                console.error(`Failed to publish post ${post.id}:`, err);
            }
        }

        return duePosts.length;
    }
    async publishPostNow(postId: number) {
        // 1. Fetch Post with Channel info
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { channel: true } // Ensure channel is fetched
        });

        if (!post) {
            throw new Error(`Post ${postId} not found`);
        }

        // 2. Get Channel ID
        const channel = await prisma.channel.findUnique({ where: { id: post.channel_id } });
        if (!channel || !channel.telegram_channel_id) {
            throw new Error(`Channel not found for post ${postId}`);
        }
        const targetChannelId = channel.telegram_channel_id.toString();

        // 3. Send Immediately
        const text = post.final_text || post.generated_text || '';

        if (post.image_url) {
            let photoSource: any = post.image_url;
            if (post.image_url.startsWith('data:')) {
                const base64Data = post.image_url.split(',')[1];
                photoSource = { source: Buffer.from(base64Data, 'base64') };
            }

            if (text.length > 1024) {
                // Split: Photo then Text
                // Send Photo
                await telegramService.sendPhoto(targetChannelId, photoSource, {
                    caption: post.topic ? `**${post.topic}**` : '',
                    parse_mode: 'Markdown'
                });

                // Send Text
                await telegramService.sendMessage(targetChannelId, text, {
                    parse_mode: 'Markdown'
                });
            } else {
                await telegramService.sendPhoto(targetChannelId, photoSource, {
                    caption: text,
                    parse_mode: 'Markdown'
                });
            }
        } else {
            await telegramService.sendMessage(targetChannelId, text, {
                parse_mode: 'Markdown'
            });
        }

        // 4. Update DB Status to published
        await prisma.post.update({
            where: { id: postId },
            data: { status: 'published' }
        });

        return true;
    }
}

export default new PublisherService();
