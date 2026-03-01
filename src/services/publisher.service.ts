import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import telegramService from './telegram.service';
import vkService from './vk.service';
import storageService from './storage.service';
import exporterService from './exporter.service';
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
                let channel = null;
                if (post.channel_id) {
                    channel = await prisma.socialChannel.findUnique({
                        where: { id: post.channel_id }
                    });
                }

                // Fallback: Find first Telegram channel for project
                if (!channel) {
                    console.log(`[Publisher] Post ${post.id} has no channel_id or channel not found. Trying default...`);
                    channel = await prisma.socialChannel.findFirst({
                        where: { project_id: post.project_id, type: 'telegram' }
                    });
                }

                if (!channel || !channel.config) {
                    console.error(`Channel not found or config missing for post ${post.id}`);
                    continue;
                }

                const text = post.final_text || post.generated_text || '';
                let sentMessageId: number | undefined;
                let publishedLink: string | null = null;
                let isPublishedViaClient = false;

                if (channel.type === 'vk') {
                    // VK Publishing Logic
                    console.log(`[Publisher] Publishing to VK for post ${post.id}`);
                    const vkConfig = channel.config as any;
                    const vkId = vkConfig.vk_id;
                    const apiKey = vkConfig.api_key;

                    if (!vkId || !apiKey) {
                        console.error(`VK config missing id/key for post ${post.id}`);
                        continue;
                    }

                    try {
                        publishedLink = await vkService.publishPost(
                            vkId,
                            apiKey,
                            text,
                            post.image_url || undefined
                        );
                        console.log(`[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    } catch (vkErr) {
                        console.error(`[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue; // Skip the rest if VK fails
                    }
                } else if (channel.type === 'telegram') {
                    // Telegram Publishing Logic
                    const targetChannelId = (channel.config as any).telegram_channel_id?.toString();
                    if (!targetChannelId) {
                        console.error(`Telegram channel config missing ID for post ${post.id}`);
                        continue;
                    }

                    // Try MTProto Client First
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        // Initialize (connect) if not already
                        await importedClient.init(post.project_id);

                        // We need to resolve image path here to pass string
                        let imagePathOrUrl: string | undefined;
                        if (post.image_url) imagePathOrUrl = post.image_url;

                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                        if (result) {
                            sentMessageId = result.id; // gramjs message object has .id
                            isPublishedViaClient = true;
                            console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                    } catch (clientErr: any) {
                        if (clientErr.message && clientErr.message.includes('FLOOD_WAIT')) {
                            console.warn(`[Publisher] FLOOD_WAIT detected: ${clientErr.message}. Skipping this run for post ${post.id}.`);
                            // Ideally schedule retry in X seconds. For now, we skip and let next scheduler run pick it up (if we don't change status)
                            // But wait, scheduler runs every 60s. If flood wait is LONG, we should update post time?
                            // For now, simple error log and fallback or abort.
                            // Let's abort this post attempt so we don't spam.
                            continue;
                        }
                        console.warn(`[Publisher] MTProto Client failed (fallback to Bot API):`, clientErr);
                    }

                    if (!isPublishedViaClient) {
                        // Fallback to Bot API Logic
                        console.log(`[Publisher] Falling back to Bot API for post ${post.id}`);

                        let sentMessage: any;
                        // ... (Existing Bot API Logic) ...

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
                            } else {
                                // Assume it's a remote URL (Supabase or other)
                                photoSource = post.image_url;
                            }

                            if (photoSource) {
                                const CAPTION_LIMIT = 1024;
                                if (text.length > CAPTION_LIMIT) {
                                    if (typeof photoSource === 'string' && photoSource.startsWith('http')) {
                                        // Send as single text with large media preview instead of splitting
                                        sentMessage = await this.sendTextSplitting(targetChannelId, text, {
                                            link_preview_options: {
                                                url: photoSource,
                                                prefer_large_media: true,
                                                show_above_text: true,
                                                is_disabled: false
                                            }
                                        });
                                    } else {
                                        // Split logic for Bot API (Local files or buffers)
                                        let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                        if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                            splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                        }
                                        if (splitIndex === -1) splitIndex = CAPTION_LIMIT;

                                        const caption = text.substring(0, splitIndex);
                                        const remainder = text.substring(splitIndex).trim();

                                        await telegramService.sendPhoto(targetChannelId, photoSource, {
                                            caption: caption,
                                            parse_mode: 'Markdown'
                                        });

                                        if (remainder.length > 0) {
                                            sentMessage = await this.sendTextSplitting(targetChannelId, remainder);
                                        } else {
                                            sentMessage = { message_id: 0 };
                                        }
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
                        sentMessageId = sentMessage?.message_id;
                    }

                    // Construct link
                    const channelUsername = (channel.config as any).channel_username;
                    if (channelUsername) {
                        publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                    } else if (targetChannelId.startsWith('-100')) {
                        const cleanId = targetChannelId.substring(4);
                        publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                    }
                    console.log(`[Publisher] Successfully published post ${post.id} to Telegram: ${targetChannelId}`);
                }

                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        status: 'published',
                        telegram_message_id: sentMessageId,
                        published_link: publishedLink
                    }
                });

                // Cleanup Image if it's from Supabase
                if (post.image_url && post.image_url.includes('supabase.co')) {
                    console.log(`[Publisher] Cleaning up Supabase image for post ${post.id}...`);
                    try {
                        await storageService.deleteFile(post.image_url);
                    } catch (cleanupErr) {
                        console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                    }
                }

                console.log(`Successfully published post ${post.id} to channel ${channel.name}`);
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
        let channel = null;
        if (post.channel_id) {
            channel = await prisma.socialChannel.findUnique({ where: { id: post.channel_id } });
        }

        if (!channel) {
            channel = await prisma.socialChannel.findFirst({
                where: { project_id: post.project_id, type: 'telegram' }
            });
        }

        if (!channel || !channel.config) {
            throw new Error(`Channel config not found for post ${postId}`);
        }

        // 3. Send Immediately
        const text = post.final_text || post.generated_text || '';
        let sentMessageId: number | undefined;
        let publishedLink: string | null = null;
        let isPublishedViaClient = false;

        if (channel.type === 'vk') {
            const vkConfig = channel.config as any;
            const vkId = vkConfig.vk_id;
            const apiKey = vkConfig.api_key;

            if (!vkId || !apiKey) {
                throw new Error(`VK config missing id/key for post ${postId}`);
            }

            publishedLink = await vkService.publishPost(
                vkId,
                apiKey,
                text,
                post.image_url || undefined
            );
        } else if (channel.type === 'telegram') {
            const targetChannelId = (channel.config as any).telegram_channel_id?.toString();
            if (!targetChannelId) {
                throw new Error(`Telegram channel config missing ID for post ${postId}`);
            }

            // Try MTProto Client First
            try {
                const importedClient = require('./telegram_client.service').default;
                // Initialize (connect) if not already
                await importedClient.init(post.project_id);

                // We need to resolve image path here to pass string
                let imagePathOrUrl: string | undefined;
                if (post.image_url) imagePathOrUrl = post.image_url;

                const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                if (result) {
                    sentMessageId = result.id; // gramjs message object has .id
                    isPublishedViaClient = true;
                    console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                }
            } catch (clientErr: any) {
                console.warn(`[Publisher] MTProto Client failed (fallback to Bot API):`, clientErr);
            }

            if (!isPublishedViaClient) {
                // Fallback to Bot API Logic
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
                    } else {
                        // Remote URL
                        photoSource = post.image_url;
                    }

                    if (photoSource) {
                        const CAPTION_LIMIT = 1024;
                        if (text.length > CAPTION_LIMIT) {
                            if (typeof photoSource === 'string' && photoSource.startsWith('http')) {
                                // Send as single text with large media preview instead of splitting
                                sentMessage = await this.sendTextSplitting(targetChannelId, text, {
                                    link_preview_options: {
                                        url: photoSource,
                                        prefer_large_media: true,
                                        show_above_text: true,
                                        is_disabled: false
                                    }
                                });
                            } else {
                                // Split: Fill caption, then rest as text
                                let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                    splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                }
                                if (splitIndex === -1) {
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
                                    sentMessage = { message_id: 0 }; // Placeholder
                                }
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
                sentMessageId = sentMessage?.message_id;
            }

            // Construct link for Telegram
            const channelUsername = (channel.config as any).channel_username;
            if (channelUsername) {
                publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
            } else if (targetChannelId.startsWith('-100')) {
                const cleanId = targetChannelId.substring(4);
                publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
            }
        }

        // 4. Update DB Status to published
        await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'published',
                telegram_message_id: sentMessageId,
                published_link: publishedLink
            }
        });

        // Cleanup Image if it's from Supabase
        if (post.image_url && post.image_url.includes('supabase.co')) {
            console.log(`[Publisher] Cleaning up Supabase image for post ${postId}...`);
            // Run in background to not block response
            storageService.deleteFile(post.image_url).catch(err => console.error(`[Publisher] Failed to cleanup image:`, err));
        }

        return true;
    }

    async scheduleNativePosts() {
        const now = new Date();
        const lookahead = new Date(now.getTime() + 5 * 60 * 1000); // Posts due in > 5m

        // Find posts that are 'scheduled' but far enough in the future
        const futurePosts = await prisma.post.findMany({
            where: {
                status: 'scheduled',
                publish_at: { gt: lookahead }
            },
            include: {
                project: {
                    include: {
                        settings: true,
                        channels: true
                    }
                }
            }
        });

        console.log(`[Publisher] Checking ${futurePosts.length} future posts for native scheduling...`);

        for (const post of futurePosts) {
            // Check if Native Scheduling is enabled for this project
            const settings = post.project.settings;
            const nativeEnabled = settings.find(s => s.key === 'telegram_native_scheduling')?.value === 'true';

            if (!nativeEnabled) continue;

            // Find Channel
            let channel = null;
            if (post.channel_id) {
                channel = post.project.channels.find(c => c.id === post.channel_id);
            } else {
                // Fallback default
                channel = post.project.channels.find(c => c.type === 'telegram');
            }

            if (!channel || channel.type !== 'telegram' || !(channel.config as any).telegram_channel_id) {
                continue;
            }

            const targetChannelId = (channel.config as any).telegram_channel_id.toString();
            const text = post.final_text || post.generated_text || '';

            // Try MTProto Client
            try {
                const importedClient = require('./telegram_client.service').default;
                await importedClient.init(post.project_id);

                let imagePathOrUrl: string | undefined;
                if (post.image_url) imagePathOrUrl = post.image_url;

                // Pass schedule param (UNIX timestamp or Date object depending on library, gramjs takes Date or int)
                // Note: telegram_client.service.ts publishPost signature needs update or we pass it in options?
                // The current publishPost signature is: (projectId, target, text, imageUrl)
                // We need to update TelegramClientService.publishPost to accept 'scheduleDate'.

                // Let's first update TelegramClientService, then come back here? 
                // Or I can update TelegramClientService.publishPost to take an options object.
                // Current signature: publishPost(projectId: number, target: string | number, text: string, imageUrl?: string | null)

                // I will assume I update TelegramClientService to accept a 5th arg 'scheduleDate'.
                const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, post.publish_at);

                if (result) {
                    console.log(`[Publisher] Scheduled natively via MTProto: Message ID ${result.id}`);

                    // Update Status
                    await prisma.post.update({
                        where: { id: post.id },
                        data: {
                            status: 'scheduled_native',
                            telegram_message_id: result.id
                        }
                    });
                }
            } catch (err) {
                console.error(`[Publisher] Failed to natively schedule post ${post.id}:`, err);
            }
        }
    }

    private async sendTextSplitting(chatId: string, text: string, extraOptions: any = {}) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            return await telegramService.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...extraOptions
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
            let isFirst = true;
            for (const chunk of chunks) {
                lastMessage = await telegramService.sendMessage(chatId, chunk, {
                    parse_mode: 'Markdown',
                    ...(isFirst ? extraOptions : {})
                });
                isFirst = false;
            }
            return lastMessage;
        }
    }
}

export default new PublisherService();
