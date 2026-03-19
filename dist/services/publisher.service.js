"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const telegram_service_1 = __importDefault(require("./telegram.service"));
const vk_service_1 = __importDefault(require("./vk.service"));
const storage_service_1 = __importDefault(require("./storage.service"));
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
// --- Simple File Logger ---
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const PUBLISHER_LOG_FILE = path.join(LOGS_DIR, 'publisher.log');
function logToFile(level, message, data) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    if (data) {
        logLine += ` | ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }
    logLine += '\n';
    // Write to file
    fs.appendFileSync(PUBLISHER_LOG_FILE, logLine);
    // Also log to console
    if (level === 'ERROR')
        console.error(message, data || '');
    else if (level === 'WARN')
        console.warn(message, data || '');
    else
        console.log(message, data || '');
}
class PublisherService {
    async publishDuePosts() {
        const now = new Date();
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
        if (duePosts.length === 0) {
            return 0;
        }
        logToFile('INFO', `[Publisher] Found ${duePosts.length} posts due (or past due) for publishing.`);
        // 🔒 LOCK POSTS immediately to prevent concurrent `setInterval` or `/jobs/publish-due` calls
        // from fetching and publishing the exact same posts simultaneously.
        await prisma.post.updateMany({
            where: { id: { in: duePosts.map(p => p.id) } },
            data: { status: 'publishing' }
        });
        for (const post of duePosts) {
            if (post.status === 'scheduled_native')
                continue;
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
                    logToFile('INFO', `[Publisher] Post ${post.id} has no channel_id or channel not found. Trying default...`);
                    channel = await prisma.socialChannel.findFirst({
                        where: { project_id: post.project_id, type: 'telegram' }
                    });
                }
                if (!channel || !channel.config) {
                    logToFile('ERROR', `Channel not found or config missing for post ${post.id}`);
                    continue;
                }
                const text = post.final_text || post.generated_text || '';
                let sentMessageId;
                let publishedLink = null;
                let isPublishedViaClient = false;
                if (channel.type === 'vk') {
                    // VK Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to VK for post ${post.id}`);
                    const vkConfig = channel.config;
                    const vkId = vkConfig.vk_id;
                    const apiKey = vkConfig.api_key;
                    if (!vkId || !apiKey) {
                        logToFile('ERROR', `VK config missing id/key for post ${post.id}`);
                        continue;
                    }
                    try {
                        publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    }
                    catch (vkErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue; // Skip the rest if VK fails
                    }
                }
                else if (channel.type === 'linkedin') {
                    // LinkedIn Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to LinkedIn for post ${post.id}`);
                    const linkedinConfig = channel.config;
                    const urn = linkedinConfig.linkedin_urn;
                    const token = linkedinConfig.access_token;
                    if (!urn || !token) {
                        logToFile('ERROR', `LinkedIn config missing urn/token for post ${post.id}`);
                        continue;
                    }
                    try {
                        const importedLinkedin = require('./linkedin.service').default;
                        publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to LinkedIn: ${publishedLink}`);
                    }
                    catch (liErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to LinkedIn:`, liErr);
                        continue;
                    }
                }
                else if (channel.type === 'telegram') {
                    // Telegram Publishing Logic
                    const rawChannelId = channel.config.telegram_channel_id?.toString();
                    if (!rawChannelId) {
                        logToFile('ERROR', `Telegram channel config missing ID for post ${post.id}`);
                        continue;
                    }
                    // ⚠️ LOCAL DEV OVERRIDE: redirect all messages to the test channel
                    const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                    const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                        ? localTestChannel
                        : rawChannelId;
                    if (targetChannelId !== rawChannelId) {
                        logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${post.id} from ${rawChannelId} → ${targetChannelId}`);
                    }
                    // Try MTProto Client First
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        // Initialize (connect) if not already
                        await importedClient.init(post.project_id);
                        // We need to resolve image path here to pass string
                        let imagePathOrUrl;
                        if (post.image_url)
                            imagePathOrUrl = post.image_url;
                        console.log(`[Publisher] Calling MTProto publishPost for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                        console.log(`[Publisher] MTProto publishPost result for post ${post.id}:`, result ? `Success (ID: ${result.id})` : 'Falsy Result');
                        if (result) {
                            sentMessageId = result.id; // gramjs message object has .id
                            isPublishedViaClient = true;
                            console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                        else {
                            console.log(`[Publisher] MTProto publishPost returned falsy for post ${post.id}. Will fallback to Bot API!`);
                        }
                    }
                    catch (clientErr) {
                        if (clientErr.message && clientErr.message.includes('FLOOD_WAIT')) {
                            console.warn(`[Publisher] FLOOD_WAIT detected: ${clientErr.message}. Skipping this run for post ${post.id}.`);
                            // ⚠️ ROLLBACK status since we skipped it
                            await prisma.post.update({
                                where: { id: post.id },
                                data: { status: 'scheduled' }
                            });
                            continue;
                        }
                        console.warn(`[Publisher] MTProto Client failed (fallback to Bot API):`, clientErr.message || clientErr);
                    }
                    if (!isPublishedViaClient) {
                        // Fallback to Bot API Logic
                        console.log(`[Publisher] Falling back to Bot API for post ${post.id}`);
                        let sentMessage;
                        // ... (Existing Bot API Logic) ...
                        if (post.image_url) {
                            let photoSource = post.image_url;
                            if (post.image_url.startsWith('data:')) {
                                const base64Data = post.image_url.split(',')[1];
                                photoSource = { source: Buffer.from(base64Data, 'base64') };
                            }
                            else if (post.image_url.startsWith('/uploads/')) {
                                const fs = require('fs');
                                const path = require('path');
                                const filename = post.image_url.split('/').pop();
                                const localPath = path.join(__dirname, '../../uploads', filename);
                                if (fs.existsSync(localPath)) {
                                    photoSource = { source: fs.createReadStream(localPath) };
                                }
                                else {
                                    console.error(`Local image file not found: ${localPath}`);
                                    photoSource = null;
                                }
                            }
                            else {
                                // Assume it's a remote URL (Supabase or other)
                                photoSource = post.image_url;
                            }
                            if (photoSource) {
                                const CAPTION_LIMIT = 1024;
                                if (text.length > CAPTION_LIMIT) {
                                    if (typeof photoSource === 'string' && photoSource.startsWith('http')) {
                                        // HTTP URL: send as text with large media preview (no split, 1 message)
                                        sentMessage = await this.sendTextSplitting(targetChannelId, text, {
                                            link_preview_options: {
                                                url: photoSource,
                                                prefer_large_media: true,
                                                show_above_text: true,
                                                is_disabled: false
                                            }
                                        });
                                    }
                                    else {
                                        // Local file / Buffer: For Bot API, if it exceeds 1024, the only way to send
                                        // it as ONE message is to send the text with a hidden link preview to the image (if it's hosted).
                                        // Since it's a local file/buffer, we HAVE to send a photo. If it exceeds 1024, the Bot API WILL fail.
                                        // However, Telegram Premium bots can have 4096. We should just try sending it as a single caption first.
                                        // If it fails with "MEDIA_CAPTION_TOO_LONG", that's when we should split.
                                        // But to prevent the user from seeing "two messages", we should log it.
                                        // Actually, let's just attempt to send it as a single photo message first.
                                        try {
                                            sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                caption: text,
                                                parse_mode: 'Markdown'
                                            });
                                        }
                                        catch (sendErr) {
                                            if (sendErr.response?.body?.description?.includes('MEDIA_CAPTION_TOO_LONG')) {
                                                console.warn(`[Publisher] Caption too long for Bot API (${text.length} chars). Splitting into photo + reply.`);
                                                let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                                if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                    splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                                }
                                                if (splitIndex === -1)
                                                    splitIndex = CAPTION_LIMIT;
                                                const caption = text.substring(0, splitIndex);
                                                const remainder = text.substring(splitIndex).trim();
                                                const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                    caption: caption,
                                                    parse_mode: 'Markdown'
                                                });
                                                if (remainder.length > 0) {
                                                    sentMessage = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                                        parse_mode: 'Markdown',
                                                        reply_to_message_id: photoMsg?.message_id
                                                    });
                                                }
                                                else {
                                                    sentMessage = photoMsg;
                                                }
                                            }
                                            else {
                                                throw sendErr;
                                            }
                                        }
                                    }
                                }
                                else {
                                    sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                        caption: text,
                                        parse_mode: 'Markdown'
                                    });
                                }
                            }
                            else {
                                sentMessage = await this.sendTextSplitting(targetChannelId, text);
                            }
                        }
                        else {
                            sentMessage = await this.sendTextSplitting(targetChannelId, text);
                        }
                        sentMessageId = sentMessage?.message_id;
                    }
                    // Construct link
                    const channelUsername = channel.config.channel_username;
                    if (channelUsername) {
                        publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                    }
                    else if (targetChannelId.startsWith('-100')) {
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
                        await storage_service_1.default.deleteFile(post.image_url);
                    }
                    catch (cleanupErr) {
                        console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                    }
                }
                console.log(`[Publisher] Successfully published post ${post.id} to channel ${channel.name}`);
            }
            catch (err) {
                console.error(`[Publisher] Failed to publish post ${post.id}:`, err);
                // ⚠️ ROLLBACK status in case of an unexpected error
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'scheduled' }
                }).catch(e => console.error(`[Publisher] Failed to rollback status for post ${post.id}`, e));
            }
        }
        return duePosts.length;
    }
    /**
     * Checks whether the MTProto (GramJS) client can connect for a given project.
     * Returns true if the session is active and the connection was successful.
     */
    async checkMTProto(projectId) {
        try {
            const importedClient = require('./telegram_client.service').default;
            const success = await importedClient.init(projectId);
            if (success) {
                return { available: true };
            }
            return { available: false, reason: 'No active Telegram account session found for this project' };
        }
        catch (e) {
            return { available: false, reason: e.message || 'MTProto connection failed' };
        }
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
        const initialStatus = post.status;
        try {
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
            // 🔒 LOCK POST to prevent concurrent running
            if (post.status === 'scheduled') {
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: 'publishing' }
                });
            }
            // 3. Send Immediately
            const text = post.final_text || post.generated_text || '';
            let sentMessageId;
            let publishedLink = null;
            let isPublishedViaClient = false;
            let publishWarning;
            if (channel.type === 'vk') {
                const vkConfig = channel.config;
                const vkId = vkConfig.vk_id;
                const apiKey = vkConfig.api_key;
                if (!vkId || !apiKey) {
                    throw new Error(`VK config missing id/key for post ${postId}`);
                }
                publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, text, post.image_url || undefined);
            }
            else if (channel.type === 'linkedin') {
                const linkedinConfig = channel.config;
                const urn = linkedinConfig.linkedin_urn;
                const token = linkedinConfig.access_token;
                if (!urn || !token) {
                    throw new Error(`LinkedIn config missing urn/token for post ${postId}`);
                }
                const importedLinkedin = require('./linkedin.service').default;
                publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
            }
            else if (channel.type === 'telegram') {
                const rawChannelId = channel.config.telegram_channel_id?.toString();
                if (!rawChannelId) {
                    throw new Error(`Telegram channel config missing ID for post ${postId}`);
                }
                // ⚠️ LOCAL DEV OVERRIDE: redirect all messages to the test channel
                const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                    ? localTestChannel
                    : rawChannelId;
                if (targetChannelId !== rawChannelId) {
                    logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${postId} from ${rawChannelId} → ${targetChannelId}`);
                }
                // --- Step 1: Check MTProto availability first ---
                const mtprotoCheck = await this.checkMTProto(post.project_id);
                if (!mtprotoCheck.available) {
                    publishWarning = `MTProto недоступен (${mtprotoCheck.reason}). Публикация через Bot API.`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }
                // --- Step 2: Try MTProto Client ---
                if (mtprotoCheck.available) {
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        let imagePathOrUrl;
                        if (post.image_url)
                            imagePathOrUrl = post.image_url;
                        logToFile('INFO', `[Publisher] publishPostNow: calling MTProto for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                        if (result) {
                            sentMessageId = result.id;
                            isPublishedViaClient = true;
                            logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                    }
                    catch (clientErr) {
                        publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                        logToFile('WARN', `[Publisher] ${publishWarning}`);
                    }
                }
                if (!isPublishedViaClient) {
                    // Fallback to Bot API Logic
                    let sentMessage;
                    if (post.image_url) {
                        let photoSource = post.image_url;
                        if (post.image_url.startsWith('data:')) {
                            const base64Data = post.image_url.split(',')[1];
                            photoSource = { source: Buffer.from(base64Data, 'base64') };
                        }
                        else if (post.image_url.startsWith('/uploads/')) {
                            const fs = require('fs');
                            const path = require('path');
                            const filename = post.image_url.split('/').pop();
                            const localPath = path.join(__dirname, '../../uploads', filename);
                            if (fs.existsSync(localPath)) {
                                photoSource = { source: fs.createReadStream(localPath) };
                            }
                            else {
                                console.error(`Local image file not found: ${localPath}`);
                                photoSource = null;
                            }
                        }
                        else {
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
                                }
                                else {
                                    // Local file / Buffer: try sending as single photo (Premium users/bots have 4096 limit)
                                    try {
                                        sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                            caption: text,
                                            parse_mode: 'Markdown'
                                        });
                                    }
                                    catch (sendErr) {
                                        if (sendErr.response?.body?.description?.includes('MEDIA_CAPTION_TOO_LONG')) {
                                            console.warn(`[Publisher] Caption too long for Bot API (${text.length} chars). Splitting into photo + reply.`);
                                            let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                            if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                            }
                                            if (splitIndex === -1) {
                                                splitIndex = CAPTION_LIMIT;
                                            }
                                            const caption = text.substring(0, splitIndex);
                                            const remainder = text.substring(splitIndex).trim();
                                            const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                caption: caption,
                                                parse_mode: 'Markdown'
                                            });
                                            if (remainder.length > 0) {
                                                // Send overflow as reply to the photo — keeps visual unit intact
                                                sentMessage = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                                    parse_mode: 'Markdown',
                                                    reply_to_message_id: photoMsg?.message_id
                                                });
                                            }
                                            else {
                                                sentMessage = photoMsg;
                                            }
                                        }
                                        else {
                                            throw sendErr;
                                        }
                                    }
                                }
                            }
                            else {
                                sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                    caption: text,
                                    parse_mode: 'Markdown'
                                });
                            }
                        }
                        else {
                            sentMessage = await this.sendTextSplitting(targetChannelId, text);
                        }
                    }
                    else {
                        sentMessage = await this.sendTextSplitting(targetChannelId, text);
                    }
                    sentMessageId = sentMessage?.message_id;
                }
                // Construct link for Telegram
                const channelUsername = channel.config.channel_username;
                if (channelUsername) {
                    publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                }
                else if (targetChannelId.startsWith('-100')) {
                    const cleanId = targetChannelId.substring(4);
                    publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                }
            }
            // Update post status
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: 'published',
                    telegram_message_id: sentMessageId,
                    published_link: publishedLink
                }
            });
            // Cleanup Supabase image after publishing (non-blocking)
            if (post.image_url && post.image_url.includes('supabase.co')) {
                logToFile('INFO', `[Publisher] Cleaning up Supabase image for post ${postId}...`);
                storage_service_1.default.deleteFile(post.image_url).catch(err => logToFile('ERROR', `[Publisher] Failed to cleanup image:`, err));
            }
            return {
                success: true,
                publishMethod: isPublishedViaClient ? 'mtproto' : (channel.type === 'vk' ? 'vk' : (channel.type === 'linkedin' ? 'linkedin' : 'bot_api')),
                warning: publishWarning
            };
        }
        catch (error) {
            // Rollback if we locked it at 'publishing'
            if (initialStatus === 'scheduled') {
                logToFile('WARN', `[Publisher] publishPostNow failed, rolling back status to ${initialStatus} for post ${postId}`);
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: initialStatus }
                }).catch(e => logToFile('ERROR', 'Failed to rollback post status', e));
            }
            throw error;
        }
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
        if (futurePosts.length > 0) {
            logToFile('INFO', `[Publisher] Checking ${futurePosts.length} future posts for native scheduling...`);
        }
        for (const post of futurePosts) {
            // Check if Native Scheduling is enabled for this project
            const settings = post.project.settings;
            const nativeEnabled = settings.find(s => s.key === 'telegram_native_scheduling')?.value === 'true';
            if (!nativeEnabled)
                continue;
            // Find Channel
            let channel = null;
            if (post.channel_id) {
                channel = post.project.channels.find(c => c.id === post.channel_id);
            }
            else {
                // Fallback default
                channel = post.project.channels.find(c => c.type === 'telegram');
            }
            if (!channel || channel.type !== 'telegram' || !channel.config.telegram_channel_id) {
                continue;
            }
            const targetChannelId = channel.config.telegram_channel_id.toString();
            const text = post.final_text || post.generated_text || '';
            // Try MTProto Client
            try {
                const importedClient = require('./telegram_client.service').default;
                await importedClient.init(post.project_id);
                let imagePathOrUrl;
                if (post.image_url)
                    imagePathOrUrl = post.image_url;
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
                    logToFile('INFO', `[Publisher] Scheduled natively via MTProto: Message ID ${result.id}`);
                    // Update Status
                    await prisma.post.update({
                        where: { id: post.id },
                        data: {
                            status: 'scheduled_native',
                            telegram_message_id: result.id
                        }
                    });
                }
            }
            catch (err) {
                logToFile('ERROR', `[Publisher] Failed to natively schedule post ${post.id}:`, err);
            }
        }
    }
    async sendTextSplitting(chatId, text, extraOptions = {}) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            return await telegram_service_1.default.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...extraOptions
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
            let lastMessage;
            let isFirst = true;
            for (const chunk of chunks) {
                lastMessage = await telegram_service_1.default.sendMessage(chatId, chunk, {
                    parse_mode: 'Markdown',
                    ...(isFirst ? extraOptions : {})
                });
                isFirst = false;
            }
            return lastMessage;
        }
    }
}
exports.default = new PublisherService();
