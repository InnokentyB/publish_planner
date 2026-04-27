import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import telegramService from './telegram.service';
import vkService from './vk.service';
import storageService from './storage.service';
import exporterService from './exporter.service';
import publicationPlanService from './publication_plan.service';
import publicationAdapterService from './publication_adapter.service';
import redditService from './reddit.service';
import gscService from './gsc.service';
import tildaService from './tilda.service';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// --- Simple File Logger ---
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const PUBLISHER_LOG_FILE = path.join(LOGS_DIR, 'publisher.log');

function logToFile(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    if (data) {
        logLine += ` | ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }
    logLine += '\n';

    // Write to file
    fs.appendFileSync(PUBLISHER_LOG_FILE, logLine);

    // Also log to console
    if (level === 'ERROR') console.error(message, data || '');
    else if (level === 'WARN') console.warn(message, data || '');
    else console.log(message, data || '');
}

class PublisherService {
    private async loadPublicationPlanContext(projectId: number) {
        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts'] }
            }
        });

        const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
        const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
        const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;

        if (!meta || !assets || !accounts) {
            return null;
        }

        return {
            meta: JSON.parse(meta),
            assets: JSON.parse(assets),
            accounts: JSON.parse(accounts),
            actions: [] as any[]
        };
    }

    async processPublicationTasks() {
        const now = new Date();
        const dueTasks = await prisma.contentItem.findMany({
            where: {
                schedule_at: { lte: now },
                status: { in: ['planned', 'ready_for_execution'] },
                assets: { not: undefined }
            },
            include: { channel: true }
        });

        if (dueTasks.length === 0) {
            return 0;
        }

        for (const task of dueTasks) {
            try {
                const depsSatisfied = await this.areTaskDependenciesSatisfied(task);
                if (!depsSatisfied) {
                    continue;
                }

                const plan = await this.loadPublicationPlanContext(task.project_id);
                if (!plan) {
                    continue;
                }

                const action = (task.assets as any)?.action;
                plan.actions = action ? [action] : [];
                const bundle = publicationPlanService.buildHandoffBundle(plan as any, task);
                const channelConfig: any = task.channel?.config || {};
                const executionMode = bundle.mode;

                if (executionMode === 'manual') {
                    await prisma.contentItem.update({
                        where: { id: task.id },
                        data: {
                            status: 'awaiting_manual_publication',
                            quality_report: {
                                ...((task.quality_report as any) || {}),
                                handoff_bundle: bundle,
                                prepared_at: new Date().toISOString()
                            } as any
                        }
                    });

                    logToFile('INFO', `[Publisher] Prepared publication task ${task.id} (${bundle.task.action_type}) for manual execution.`);
                    continue;
                }

                const automatedResult = await this.executeAutomatedPublicationTask(task, bundle, channelConfig, plan as any);
                const nextStatus = automatedResult.manualFallback ? 'awaiting_manual_publication' : 'published';

                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: nextStatus,
                        published_link: automatedResult.publishedLink || task.published_link,
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            handoff_bundle: bundle,
                            execution_result: automatedResult,
                            prepared_at: new Date().toISOString()
                        } as any,
                        metrics: {
                            ...((task.metrics as any) || {}),
                            last_execution_at: new Date().toISOString(),
                            ...(automatedResult.metrics ? automatedResult.metrics : {})
                        } as any
                    }
                });

                logToFile('INFO', `[Publisher] Processed publication task ${task.id} (${bundle.task.action_type}) via automated adapter.`);
            } catch (error) {
                logToFile('ERROR', `[Publisher] Failed to process publication task ${task.id}`, error);
            }
        }

        return dueTasks.length;
    }

    private async areTaskDependenciesSatisfied(task: any) {
        const explicitActionDeps = ((task.assets as any)?.action?.dependencies || []) as string[];
        if (explicitActionDeps.length > 0) {
            const dependencyCount = await prisma.contentItem.count({
                where: {
                    project_id: task.project_id,
                    OR: explicitActionDeps.map((dep) => ({
                        metrics: {
                            path: ['task_id'],
                            equals: dep
                        }
                    })),
                    status: 'published'
                }
            });

            if (dependencyCount < explicitActionDeps.length) {
                return false;
            }
        }

        const linkedDeps = Array.isArray(task.cross_link_to) ? task.cross_link_to.filter((value: any) => typeof value === 'number') : [];
        if (linkedDeps.length > 0) {
            const linkedCount = await prisma.contentItem.count({
                where: {
                    id: { in: linkedDeps },
                    project_id: task.project_id,
                    status: 'published'
                }
            });

            if (linkedCount < linkedDeps.length) {
                return false;
            }
        }

        return true;
    }

    private async executeAutomatedPublicationTask(task: any, bundle: any, channelConfig: any, plan: any) {
        const channelType = task.channel?.type;
        const action = (task.assets as any)?.action || {};

        if (channelType === 'reddit') {
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title
                || action.parameters?.title
                || task.title
                || 'Reddit discussion';
            const subreddit = action.parameters?.subreddit || action.parameters?.sr || action.assets?.subreddit || task.layer;
            const text = bundle.publication?.body || '';
            const result = await redditService.submitDiscussionPost(channelConfig.raw_account || channelConfig, {
                subreddit,
                title,
                text
            });
            return {
                adapter: 'reddit',
                publishedLink: result.url,
                metrics: {
                    reddit_post_name: result.name || null
                }
            };
        }

        if (channelType === 'google_search_console') {
            const targetUrlRef = (task.assets as any)?.gsc_action?.url_ref || (task.assets as any)?.target_url_ref;
            const parentAction = (task.assets as any)?.parent_action_id
                ? plan.actions.find((item: any) => item.id === (task.assets as any)?.parent_action_id)
                : null;
            const resolvedTargetUrl = targetUrlRef ? this.resolvePlanRef(plan, targetUrlRef) : null;
            const fallbackLink = task.published_link || resolvedTargetUrl || parentAction?.parameters?.link_url_ref || null;
            const inspection = fallbackLink ? await gscService.inspectUrl(channelConfig.raw_account || channelConfig, fallbackLink) : null;
            const metrics = fallbackLink ? await gscService.queryPageMetrics(channelConfig.raw_account || channelConfig, fallbackLink) : null;

            return {
                adapter: 'gsc',
                publishedLink: fallbackLink,
                metrics: {
                    gsc_inspection: inspection,
                    gsc_page_metrics: metrics
                }
            };
        }

        if (channelType === 'tilda') {
            const result = await tildaService.executePublish(channelConfig.raw_account || channelConfig, {
                task,
                bundle
            });

            if (result.mode === 'manual_required') {
                return {
                    adapter: 'tilda',
                    manualFallback: true,
                    reason: result.reason
                };
            }

            return {
                adapter: 'tilda',
                publishedLink: bundle.publication?.link_url || null,
                metrics: {
                    tilda_publish_response: result.response || null
                }
            };
        }

        return {
            adapter: 'unknown',
            manualFallback: true,
            reason: `No automated executor configured for channel type ${channelType}`
        };
    }

    private resolvePlanRef(plan: any, ref?: string | null): any {
        if (!ref) return null;
        const parts = ref.split('.');
        let current: any = plan;
        for (const part of parts) {
            if (current == null) return null;
            current = current[part];
        }
        return current ?? null;
    }

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
                let sentMessageId: number | undefined;
                let publishedLink: string | null = null;
                let isPublishedViaClient = false;

                if (channel.type === 'vk') {
                    // VK Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to VK for post ${post.id}`);
                    const vkConfig = channel.config as any;
                    const vkId = vkConfig.vk_id;
                    const apiKey = vkConfig.api_key;

                    if (!vkId || !apiKey) {
                        logToFile('ERROR', `VK config missing id/key for post ${post.id}`);
                        continue;
                    }

                    try {
                        publishedLink = await vkService.publishPost(
                            vkId,
                            apiKey,
                            text,
                            post.image_url || undefined
                        );
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    } catch (vkErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue; // Skip the rest if VK fails
                    }
                } else if (channel.type === 'linkedin') {
                    // LinkedIn Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to LinkedIn for post ${post.id}`);
                    const linkedinConfig = channel.config as any;
                    const urn = linkedinConfig.linkedin_urn;
                    const token = linkedinConfig.access_token;

                    if (!urn || !token) {
                        logToFile('ERROR', `LinkedIn config missing urn/token for post ${post.id}`);
                        continue;
                    }

                    try {
                        const importedLinkedin = require('./linkedin.service').default;
                        publishedLink = await importedLinkedin.publishPost(
                            urn,
                            token,
                            text,
                            post.image_url || undefined
                        );
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to LinkedIn: ${publishedLink}`);
                    } catch (liErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to LinkedIn:`, liErr);
                        continue;
                    }
                } else if (channel.type === 'telegram') {
                    // Telegram Publishing Logic
                    const rawChannelId = (channel.config as any).telegram_channel_id?.toString();
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
                        let imagePathOrUrl: string | undefined;
                        if (post.image_url) imagePathOrUrl = post.image_url;

                        console.log(`[Publisher] Calling MTProto publishPost for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                        console.log(`[Publisher] MTProto publishPost result for post ${post.id}:`, result ? `Success (ID: ${result.id})` : 'Falsy Result');

                        if (result) {
                            sentMessageId = result.id; // gramjs message object has .id
                            isPublishedViaClient = true;
                            console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        } else {
                            console.log(`[Publisher] MTProto publishPost returned falsy for post ${post.id}. Will fallback to Bot API!`);
                        }
                    } catch (clientErr: any) {
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
                                        // HTTP URL: send as text with large media preview (no split, 1 message)
                                        sentMessage = await this.sendTextSplitting(targetChannelId, text, {
                                            link_preview_options: {
                                                url: photoSource,
                                                prefer_large_media: true,
                                                show_above_text: true,
                                                is_disabled: false
                                            }
                                        });
                                    } else {
                                        // Local file / Buffer: For Bot API, if it exceeds 1024, the only way to send
                                        // it as ONE message is to send the text with a hidden link preview to the image (if it's hosted).
                                        // Since it's a local file/buffer, we HAVE to send a photo. If it exceeds 1024, the Bot API WILL fail.
                                        // However, Telegram Premium bots can have 4096. We should just try sending it as a single caption first.
                                        // If it fails with "MEDIA_CAPTION_TOO_LONG", that's when we should split.
                                        // But to prevent the user from seeing "two messages", we should log it.
                                        // Actually, let's just attempt to send it as a single photo message first.
                                        try {
                                            sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                                caption: text,
                                                parse_mode: 'Markdown'
                                            });
                                        } catch (sendErr: any) {
                                            if (sendErr.response?.body?.description?.includes('MEDIA_CAPTION_TOO_LONG')) {
                                                console.warn(`[Publisher] Caption too long for Bot API (${text.length} chars). Splitting into photo + reply.`);
                                                let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                                if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                    splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                                }
                                                if (splitIndex === -1) splitIndex = CAPTION_LIMIT;

                                                const caption = text.substring(0, splitIndex);
                                                const remainder = text.substring(splitIndex).trim();

                                                const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                                    caption: caption,
                                                    parse_mode: 'Markdown'
                                                });

                                                if (remainder.length > 0) {
                                                    sentMessage = await telegramService.sendMessage(targetChannelId, remainder, {
                                                        parse_mode: 'Markdown',
                                                        reply_to_message_id: photoMsg?.message_id
                                                    });
                                                } else {
                                                    sentMessage = photoMsg;
                                                }
                                            } else {
                                                throw sendErr;
                                            }
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

                console.log(`[Publisher] Successfully published post ${post.id} to channel ${channel.name}`);
            } catch (err) {
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
    async checkMTProto(projectId: number): Promise<{ available: boolean; reason?: string }> {
        try {
            const importedClient = require('./telegram_client.service').default;
            const success = await importedClient.init(projectId);
            if (success) {
                return { available: true };
            }
            return { available: false, reason: 'No active Telegram account session found for this project' };
        } catch (e: any) {
            return { available: false, reason: e.message || 'MTProto connection failed' };
        }
    }

    async publishPostNow(postId: number): Promise<{ success: boolean; publishMethod: 'mtproto' | 'bot_api' | 'vk' | 'linkedin'; warning?: string }> {
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
        let sentMessageId: number | undefined;
        let publishedLink: string | null = null;
        let isPublishedViaClient = false;
        let publishWarning: string | undefined;

        if (channel.type === 'vk') {
            const vkConfig = channel.config as any;
            const vkId = vkConfig.vk_id;
            const apiKey = vkConfig.api_key;
            if (!vkId || !apiKey) {
                throw new Error(`VK config missing id/key for post ${postId}`);
            }
            publishedLink = await vkService.publishPost(vkId, apiKey, text, post.image_url || undefined);
        } else if (channel.type === 'linkedin') {
            const linkedinConfig = channel.config as any;
            const urn = linkedinConfig.linkedin_urn;
            const token = linkedinConfig.access_token;
            if (!urn || !token) {
                throw new Error(`LinkedIn config missing urn/token for post ${postId}`);
            }
            const importedLinkedin = require('./linkedin.service').default;
            publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
        } else if (channel.type === 'telegram') {
            const rawChannelId = (channel.config as any).telegram_channel_id?.toString();
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
                    let imagePathOrUrl: string | undefined;
                    if (post.image_url) imagePathOrUrl = post.image_url;

                    logToFile('INFO', `[Publisher] publishPostNow: calling MTProto for post ${post.id}`);
                    const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl);
                    if (result) {
                        sentMessageId = result.id;
                        isPublishedViaClient = true;
                        logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                    }
                } catch (clientErr: any) {
                    publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }
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
                                // Local file / Buffer: try sending as single photo (Premium users/bots have 4096 limit)
                                try {
                                    sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                        caption: text,
                                        parse_mode: 'Markdown'
                                    });
                                } catch (sendErr: any) {
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

                                        const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                            caption: caption,
                                            parse_mode: 'Markdown'
                                        });

                                        if (remainder.length > 0) {
                                            // Send overflow as reply to the photo — keeps visual unit intact
                                            sentMessage = await telegramService.sendMessage(targetChannelId, remainder, {
                                                parse_mode: 'Markdown',
                                                reply_to_message_id: photoMsg?.message_id
                                            });
                                        } else {
                                            sentMessage = photoMsg;
                                        }
                                    } else {
                                        throw sendErr;
                                    }
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
            storageService.deleteFile(post.image_url).catch(err => logToFile('ERROR', `[Publisher] Failed to cleanup image:`, err));
        }

        return {
            success: true,
            publishMethod: isPublishedViaClient ? 'mtproto' as const : (channel.type === 'vk' ? 'vk' as const : (channel.type === 'linkedin' ? 'linkedin' as const : 'bot_api' as const)),
            warning: publishWarning
        };
        } catch (error: any) {
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
            } catch (err) {
                logToFile('ERROR', `[Publisher] Failed to natively schedule post ${post.id}:`, err);
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
