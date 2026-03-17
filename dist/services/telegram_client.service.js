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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramClientService = void 0;
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
const tl_1 = require("telegram/tl");
const markdown_1 = require("telegram/extensions/markdown");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class TelegramClientService {
    constructor() {
        this.client = null;
        this.sessionString = "";
        this.apiId = 0;
        this.apiHash = "";
        this.phoneNumber = "";
    }
    /**
     * Initialize client with data from DB for a specific project
     */
    async init(projectId = 1) {
        // @ts-ignore
        const account = await prisma.telegramAccount.findFirst({
            where: { project_id: projectId, is_active: true }
        });
        if (!account) {
            console.log(`[TelegramClient] No active account found for project ${projectId}`);
            return false;
        }
        this.sessionString = account.session_string;
        this.apiId = account.api_id;
        this.apiHash = account.api_hash;
        this.phoneNumber = account.phone_number;
        try {
            this.client = new telegram_1.TelegramClient(new sessions_1.StringSession(this.sessionString), this.apiId, this.apiHash, { connectionRetries: 5 });
            // Connect without login if session is valid? 
            // Actually connect() does not trigger interactive login if session is present.
            await this.client.connect();
            console.log(`[TelegramClient] Connected as ${this.phoneNumber}`);
            return true;
        }
        catch (e) {
            console.error(`[TelegramClient] Failed to connect:`, e);
            return false;
        }
    }
    async getClient(projectId = 1) {
        if (!this.client) {
            const success = await this.init(projectId);
            if (!success)
                return null;
        }
        return this.client;
    }
    /**
     * Publish a post to a channel/chat
     * @param target which could be a username, phone number, or chat ID
     */
    async publishPost(projectId, target, text, imageUrl, scheduleDate) {
        const client = await this.getClient(projectId);
        if (!client) {
            throw new Error("Telegram Client not initialized or no account found.");
        }
        // Resolve target if it's a string ID like "-100123..."
        let entity = target;
        try {
            if (typeof target === 'string' && (target.startsWith('-100') || !isNaN(Number(target)))) {
                // It's likely an ID. gram.js usually prefers BigInt for IDs or resolving entities.
                // However, getting entity by ID often works if it's in cache or we force fetch.
                // For now, let's try passing as is, or converting to BigInt if needed.
                // GramJS handles strings like usernames ok.
                // IDs are tricky.
                try {
                    // Try getting entity by string ID directly
                    entity = await client.getEntity(target);
                }
                catch (e) {
                    // If failed, and it looks like an ID, try as generic input (gram.js usually parses strings ok)
                    if (/^-?\d+$/.test(target)) {
                        // Some versions want types.long or BigInt, but native bigint can mismatch types.
                        // We try passing as string or number if within safe range, or any-cast if needed.
                        try {
                            entity = await client.getEntity(target);
                        }
                        catch (e2) {
                            // Last resort, cast to any to try native bigint or specialized type
                            // @ts-ignore
                            entity = await client.getEntity(BigInt(target));
                        }
                    }
                }
            }
            else {
                entity = await client.getEntity(target);
            }
        }
        catch (e) {
            console.error(`[TelegramClient] Failed to resolve entity ${target}:`, e);
            throw new Error(`Could not access channel: ${target}`);
        }
        let tempFilePath;
        try {
            let result;
            if (imageUrl) {
                // Determine file source
                let fileSource;
                if (imageUrl.startsWith('data:')) {
                    const base64Data = imageUrl.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');
                    const uploadDir = path.join(__dirname, '../../uploads');
                    if (!fs.existsSync(uploadDir)) {
                        fs.mkdirSync(uploadDir, { recursive: true });
                    }
                    tempFilePath = path.join(uploadDir, `temp_${Date.now()}.jpg`);
                    fs.writeFileSync(tempFilePath, buffer);
                    fileSource = tempFilePath;
                }
                else if (imageUrl.startsWith('http')) {
                    fileSource = imageUrl; // GramJS can sometimes handle URLs, but often better to download buffer
                    // For now let implementation handle URL if library supports, else we might need to download
                }
                else if (imageUrl.startsWith('/uploads/')) {
                    const filename = imageUrl.split('/').pop();
                    const localPath = path.join(__dirname, '../../uploads', filename || '');
                    if (fs.existsSync(localPath)) {
                        fileSource = localPath; // Uploading local path works in gramjs
                    }
                }
                let scheduleTime;
                if (scheduleDate) {
                    scheduleTime = Math.floor(scheduleDate.getTime() / 1000);
                }
                if (!fileSource) {
                    // Fallback to text only if image fails? Or Error?
                    console.warn(`[TelegramClient] Image source invalid: ${imageUrl}. Sending text only.`);
                    result = await client.sendMessage(entity, {
                        message: text,
                        schedule: scheduleTime
                    });
                }
                else {
                    const CAPTION_LIMIT = 1024;
                    console.log(`[TelegramClient] Text length: ${text.length}, CAPTION_LIMIT: ${CAPTION_LIMIT}, hasImageUrl: ${!!imageUrl}`);
                    if (text.length > CAPTION_LIMIT) {
                        console.log(`[TelegramClient] Text exceeds CAPTION_LIMIT (${text.length} > ${CAPTION_LIMIT}). Splitting logic triggered.`);
                        if (imageUrl.startsWith('http')) {
                            console.log(`[TelegramClient] imageUrl is HTTP URL. Attempting invisible char trick for web preview instead of file upload.`);
                            // Use invisible markdown link trick to generate web preview for large images.
                            // GramJS's markdown parser doesn't detect [text](url) properly, so we parse manually
                            // and inject the URL entity at offset 0.
                            const invisibleChar = '\u200B';
                            const [parsedText, entities] = markdown_1.MarkdownParser.parse(invisibleChar + text);
                            entities.unshift(new tl_1.Api.MessageEntityTextUrl({
                                offset: 0,
                                length: 1,
                                url: imageUrl
                            }));
                            result = await client.sendMessage(entity, {
                                message: parsedText,
                                formattingEntities: entities,
                                schedule: scheduleTime
                            });
                            console.log(`[TelegramClient] Message sent via invisible URL trick. Sent length: ${parsedText.length}`);
                        }
                        else {
                            console.log(`[TelegramClient] imageUrl is local file or data URI, cannot use URL preview trick. Attempting to send as single message...`);
                            try {
                                result = await client.sendMessage(entity, {
                                    message: text,
                                    file: fileSource,
                                    parseMode: "markdown",
                                    schedule: scheduleTime
                                });
                                console.log(`[TelegramClient] Sent as single large message successfully.`);
                            }
                            catch (clientSendErr) {
                                if (clientSendErr.message && clientSendErr.message.includes('MEDIA_CAPTION_TOO_LONG')) {
                                    console.log(`[TelegramClient] User lacks Premium or limits exceeded. Triggering manual chunk splitting.`);
                                    // Need to split for local files
                                    let splitIndex = text.lastIndexOf('\n', CAPTION_LIMIT);
                                    if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                        splitIndex = text.lastIndexOf(' ', CAPTION_LIMIT);
                                    }
                                    if (splitIndex === -1)
                                        splitIndex = CAPTION_LIMIT;
                                    console.log(`[TelegramClient] First chunk splitIndex selected at: ${splitIndex}`);
                                    const caption = text.substring(0, splitIndex);
                                    let remainder = text.substring(splitIndex).trim();
                                    console.log(`[TelegramClient] Sending first chunk with media. Caption length: ${caption.length}`);
                                    const firstMsg = await client.sendMessage(entity, {
                                        message: caption,
                                        file: fileSource,
                                        parseMode: "markdown",
                                        schedule: scheduleTime
                                    });
                                    // Send remaining chunks
                                    const MAX_LENGTH = 4090;
                                    let chunkCounter = 1;
                                    while (remainder.length > 0) {
                                        let chunk = remainder.substring(0, MAX_LENGTH);
                                        const lastNewline = chunk.lastIndexOf('\n');
                                        if (lastNewline > MAX_LENGTH * 0.8) {
                                            chunk = remainder.substring(0, lastNewline);
                                        }
                                        console.log(`[TelegramClient] Sending remainder chunk ${chunkCounter}. Chunk length: ${chunk.length}`);
                                        result = await client.sendMessage(entity, {
                                            message: chunk,
                                            parseMode: "markdown",
                                            schedule: scheduleTime,
                                            replyTo: firstMsg ? firstMsg.id : undefined
                                        });
                                        chunkCounter++;
                                        remainder = remainder.substring(chunk.length).trim();
                                    }
                                    console.log(`[TelegramClient] Completed manual chunking. Total remainder chunks sent: ${chunkCounter - 1}`);
                                }
                                else {
                                    throw clientSendErr;
                                }
                            }
                        }
                    }
                    else {
                        console.log(`[TelegramClient] Text length within CAPTION_LIMIT (${text.length} <= ${CAPTION_LIMIT}). Sending one single message with media.`);
                        // Regular message with media
                        result = await client.sendMessage(entity, {
                            message: text,
                            file: fileSource,
                            parseMode: "markdown",
                            schedule: scheduleTime
                        });
                    }
                }
            }
            else {
                console.log(`[TelegramClient] No image provided. Target text length: ${text.length}. Sending text-only message.`);
                // Text only
                let scheduleTime;
                if (scheduleDate) {
                    scheduleTime = Math.floor(scheduleDate.getTime() / 1000);
                }
                result = await client.sendMessage(entity, {
                    message: text,
                    parseMode: "markdown",
                    schedule: scheduleTime
                });
                console.log(`[TelegramClient] Text-only message sent successfully.`);
            }
            return result;
        }
        catch (e) {
            console.error(`[TelegramClient] Publish error:`, e);
            if (e.seconds) {
                // FloodWaitError handling
                throw new Error(`FLOOD_WAIT_${e.seconds}`); // Throw specific error to be caught by caller
            }
            throw e;
        }
        finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                }
                catch (cleanupErr) {
                    console.error(`[TelegramClient] Failed to cleanup temp file:`, cleanupErr);
                }
            }
        }
    }
    // Helper to generate session string (login flow)
    static async generateSession(apiId, apiHash, phone, codeCb, passwordCb) {
        const client = new telegram_1.TelegramClient(new sessions_1.StringSession(""), apiId, apiHash, { connectionRetries: 5 });
        await client.start({
            phoneNumber: phone,
            password: async () => await passwordCb(),
            phoneCode: async () => await codeCb(),
            onError: (err) => console.log(err),
        });
        const session = client.session.save(); // Casting because return type might be mismatched in types
        await client.disconnect();
        return session;
    }
    /**
     * Fetches metrics (views, forwards/reposts, reactions) for a specific Telegram message via MTProto.
     * Note: This requires the client to be a member of the channel or chat.
     * @param projectId The project ID (to get correct session)
     * @param target The channel ID or username
     * @param messageId The telegram message ID
     */
    async getMetrics(projectId, target, messageId) {
        const client = await this.getClient(projectId);
        if (!client) {
            console.warn(`[TelegramClient] Cannot fetch metrics. Client not initialized for project: ${projectId}`);
            return null;
        }
        try {
            // First resolve entity
            let entity = target;
            if (typeof target === 'string' && (target.startsWith('-100') || !isNaN(Number(target)))) {
                try {
                    entity = await client.getEntity(target);
                }
                catch (e) {
                    if (/^-?\d+$/.test(target)) {
                        // @ts-ignore
                        entity = await client.getEntity(BigInt(target));
                    }
                }
            }
            else {
                entity = await client.getEntity(target);
            }
            // Fetch the specific message
            // getMessages returns an array of messages
            const messages = await client.getMessages(entity, {
                ids: [messageId]
            });
            if (!messages || messages.length === 0 || !messages[0]) {
                console.log(`[TelegramClient] Message ${messageId} not found in ${target}`);
                return null;
            }
            const message = messages[0];
            // Parse Views and Forwards 
            const views = typeof message.views === 'number' ? message.views : 0;
            const forwards = typeof message.forwards === 'number' ? message.forwards : 0;
            // Parse Reactions (Likes, Comments equivalent)
            let reactionsCount = 0;
            if (message.reactions && message.reactions.results) {
                for (const reaction of message.reactions.results) {
                    reactionsCount += reaction.count || 0;
                }
            }
            // Telegram Channels can have discussion groups (comments) - message.replies
            const commentsCount = message.replies?.replies || 0;
            return {
                views: views,
                likes: reactionsCount, // Grouping all reactions under "likes" or "reactions"
                comments: commentsCount,
                reposts: forwards,
                retrieved_at: new Date().toISOString()
            };
        }
        catch (err) {
            console.error(`[TelegramClient] Failed to get metrics for message ${messageId}:`, err);
            return null;
        }
    }
}
exports.TelegramClientService = TelegramClientService;
exports.default = new TelegramClientService();
