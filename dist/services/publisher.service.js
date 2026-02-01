"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const telegram_service_1 = __importDefault(require("./telegram.service"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
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
            if (post.status === 'scheduled_native')
                continue;
            try {
                // Get the channel for this post
                const channel = await prisma.socialChannel.findUnique({
                    where: { id: post.channel_id || 0 }
                });
                if (!channel || channel.type !== 'telegram' || !channel.config.telegram_channel_id) {
                    console.error(`Channel not found or telegram config missing for post ${post.id}`);
                    continue;
                }
                const targetChannelId = channel.config.telegram_channel_id.toString();
                const text = post.final_text || post.generated_text || '';
                if (post.image_url) {
                    let photoSource = post.image_url;
                    if (post.image_url.startsWith('data:')) {
                        const base64Data = post.image_url.split(',')[1];
                        photoSource = { source: Buffer.from(base64Data, 'base64') };
                    }
                    // Check length for caption (limit 1024)
                    if (text.length > 1024) {
                        // Send photo with title/topic only
                        await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                            caption: post.topic ? `**${post.topic}**` : '',
                            parse_mode: 'Markdown'
                        });
                        // Send full text as separate message(s)
                        await this.sendTextSplitting(targetChannelId, text);
                    }
                    else {
                        await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                            caption: text,
                            parse_mode: 'Markdown'
                        });
                    }
                }
                else {
                    await this.sendTextSplitting(targetChannelId, text);
                }
                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'published' }
                });
                console.log(`Successfully published post ${post.id} to channel ${targetChannelId}`);
            }
            catch (err) {
                console.error(`Failed to publish post ${post.id}:`, err);
            }
        }
        return duePosts.length;
    }
    async publishPostNow(postId) {
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
        if (!channel || channel.type !== 'telegram' || !channel.config.telegram_channel_id) {
            throw new Error(`Telegram channel config not found for post ${postId}`);
        }
        const targetChannelId = channel.config.telegram_channel_id.toString();
        // 3. Send Immediately
        const text = post.final_text || post.generated_text || '';
        if (post.image_url) {
            let photoSource = post.image_url;
            if (post.image_url.startsWith('data:')) {
                const base64Data = post.image_url.split(',')[1];
                photoSource = { source: Buffer.from(base64Data, 'base64') };
            }
            if (text.length > 1024) {
                // Split: Photo then Text
                // Send Photo
                await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                    caption: post.topic ? `**${post.topic}**` : '',
                    parse_mode: 'Markdown'
                });
                // Send Text
                await this.sendTextSplitting(targetChannelId, text);
            }
            else {
                await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                    caption: text,
                    parse_mode: 'Markdown'
                });
            }
        }
        else {
            await this.sendTextSplitting(targetChannelId, text);
        }
        // 4. Update DB Status to published
        await prisma.post.update({
            where: { id: postId },
            data: { status: 'published' }
        });
        return true;
    }
    async sendTextSplitting(chatId, text) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            await telegram_service_1.default.sendMessage(chatId, text, {
                parse_mode: 'Markdown'
            });
        }
        else {
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
            for (const chunk of chunks) {
                await telegram_service_1.default.sendMessage(chatId, chunk, {
                    parse_mode: 'Markdown'
                });
            }
        }
    }
}
exports.default = new PublisherService();
