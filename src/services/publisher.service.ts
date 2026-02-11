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
                    in: ['scheduled', 'scheduled_native']
                },
                publish_at: { lte: now }
            },
            include: {
                week: true
            }
        });

        console.log(`Found ${duePosts.length} posts due (or past due) for publishing.`);

        for (const post of duePosts) {
            if (post.status === 'scheduled_native') continue;

            try {
                // Get the channel for this post
                const channel = await prisma.socialChannel.findUnique({
                    where: { id: post.channel_id || 0 }
                });

                if (!channel || channel.type !== 'telegram' || !(channel.config as any).telegram_channel_id) {
                    console.error(`Channel not found or telegram config missing for post ${post.id}`);
                    continue;
                }

                const targetChannelId = (channel.config as any).telegram_channel_id.toString();
                const text = post.final_text || post.generated_text || '';

                let sentMessage: any;

                if (post.image_url) {
                    let photoSource: any = post.image_url;
                    if (post.image_url.startsWith('data:')) {
                        const base64Data = post.image_url.split(',')[1];
                        photoSource = { source: Buffer.from(base64Data, 'base64') };
                    } else if (post.image_url.startsWith('/uploads/')) {
                        const fs = require('fs');
                        const path = require('path');
                        const filename = post.image_url.split('/').pop();
                        const localPath = path.join(__dirname, '../../uploads', filename);

                        if (fs.existsSync(localPath)) {
                            photoSource = { source: fs.createReadStream(localPath) };
                        } else {
                            console.error(`Local image file not found: ${localPath}`);
                            photoSource = null;
                        }
                    }

                    if (photoSource) {
                        const CAPTION_LIMIT = 1024;
                        if (text.length > CAPTION_LIMIT) {
                            // Split: Fill caption, then rest as text
                            // Simple split logic: find last newline before limit
                            let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                            if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                // If no newline or it's too early, split by space
                                splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                            }
                            if (splitIndex === -1) {
                                // Force split
                                splitIndex = CAPTION_LIMIT;
                            }

                            const caption = text.substring(0, splitIndex);
                            const remainder = text.substring(splitIndex).trim();

                            await telegramService.sendPhoto(targetChannelId, photoSource, {
                                caption: caption,
                                parse_mode: 'Markdown'
                            });

                            if (remainder.length > 0) {
                                sentMessage = await this.sendTextSplitting(targetChannelId, remainder);
                            } else {
                                // Should unlikely happen given checks, but just in case
                                sentMessage = { message_id: 0 }; // Placeholder
                            }
                        } else {
                            sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                caption: text,
                                parse_mode: 'Markdown'
                            });
                        }
                    } else {
                        // Image missing or invalid, send text only
                        sentMessage = await this.sendTextSplitting(targetChannelId, text);
                    }
                } else {
                    sentMessage = await this.sendTextSplitting(targetChannelId, text);
                }

                // Construct link
                // Assuming public channel. If private, link structure is different but t.me/c/ID/MSG_ID works for members
                let publishedLink = null;
                const channelUsername = (channel.config as any).channel_username; // We might need to store this in config

                // Fallback logic for link
                if (channelUsername) {
                    publishedLink = `https://t.me/${channelUsername}/${sentMessage?.message_id}`;
                } else if (targetChannelId.startsWith('-100')) {
                    // Private channel format: https://t.me/c/CHANNEL_ID_WITHOUT_-100/MSG_ID
                    const cleanId = targetChannelId.substring(4);
                    publishedLink = `https://t.me/c/${cleanId}/${sentMessage?.message_id}`;
                }

                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        status: 'published',
                        telegram_message_id: sentMessage?.message_id,
                        published_link: publishedLink
                    }
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
            include: { channel: true }
        });

        if (!post) {
            throw new Error(`Post ${postId} not found`);
        }

        // 2. Get Channel info
        const channel = await prisma.socialChannel.findUnique({ where: { id: post.channel_id || 0 } });
        if (!channel || channel.type !== 'telegram' || !(channel.config as any).telegram_channel_id) {
            throw new Error(`Telegram channel config not found for post ${postId}`);
        }
        const targetChannelId = (channel.config as any).telegram_channel_id.toString();

        // 3. Send Immediately
        const text = post.final_text || post.generated_text || '';
        let sentMessage: any;

        if (post.image_url) {
            let photoSource: any = post.image_url;
            if (post.image_url.startsWith('data:')) {
                const base64Data = post.image_url.split(',')[1];
                photoSource = { source: Buffer.from(base64Data, 'base64') };
            } else if (post.image_url.startsWith('/uploads/')) {
                const fs = require('fs');
                const path = require('path');
                const filename = post.image_url.split('/').pop();
                const localPath = path.join(__dirname, '../../uploads', filename);

                if (fs.existsSync(localPath)) {
                    photoSource = { source: fs.createReadStream(localPath) };
                } else {
                    console.error(`Local image file not found: ${localPath}`);
                    photoSource = null;
                }
            }

            if (photoSource) {
                const CAPTION_LIMIT = 1024;
                if (text.length > CAPTION_LIMIT) {
                    // Split: Fill caption, then rest as text
                    // Simple split logic: find last newline before limit
                    let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                    if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                        // If no newline or it's too early, split by space
                        splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                    }
                    if (splitIndex === -1) {
                        // Force split
                        splitIndex = CAPTION_LIMIT;
                    }

                    const caption = text.substring(0, splitIndex);
                    const remainder = text.substring(splitIndex).trim();

                    await telegramService.sendPhoto(targetChannelId, photoSource, {
                        caption: caption,
                        parse_mode: 'Markdown'
                    });

                    if (remainder.length > 0) {
                        sentMessage = await this.sendTextSplitting(targetChannelId, remainder);
                    } else {
                        // Should unlikely happen given checks, but just in case
                        sentMessage = { message_id: 0 }; // Placeholder
                    }
                } else {
                    sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                        caption: text,
                        parse_mode: 'Markdown'
                    });
                }
            } else {
                sentMessage = await this.sendTextSplitting(targetChannelId, text);
            }
        } else {
            sentMessage = await this.sendTextSplitting(targetChannelId, text);
        }

        // Construct link
        let publishedLink = null;
        const channelUsername = (channel.config as any).channel_username;
        if (channelUsername) {
            publishedLink = `https://t.me/${channelUsername}/${sentMessage?.message_id}`;
        } else if (targetChannelId.startsWith('-100')) {
            const cleanId = targetChannelId.substring(4);
            publishedLink = `https://t.me/c/${cleanId}/${sentMessage?.message_id}`;
        }

        // 4. Update DB Status to published
        await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'published',
                telegram_message_id: sentMessage?.message_id,
                published_link: publishedLink
            }
        });

        return true;
    }

    private async sendTextSplitting(chatId: string, text: string) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            return await telegramService.sendMessage(chatId, text, {
                parse_mode: 'Markdown'
            });
        } else {
            // Split logic
            const chunks = [];
            let remaining = text;
            while (remaining.length > 0) {
                let chunk = remaining.substring(0, MAX_LENGTH);
                // Try to cut at newline
                const lastNewline = chunk.lastIndexOf('\n');
                if (lastNewline > MAX_LENGTH * 0.8) {
                    chunk = remaining.substring(0, lastNewline);
                }
                chunks.push(chunk);
                remaining = remaining.substring(chunk.length);
            }

            let lastMessage;
            for (const chunk of chunks) {
                lastMessage = await telegramService.sendMessage(chatId, chunk, {
                    parse_mode: 'Markdown'
                });
            }
            return lastMessage;
        }
    }
}

export default new PublisherService();
