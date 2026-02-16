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
    async publishPost(projectId, target, text, imageUrl) {
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
        try {
            let result;
            if (imageUrl) {
                // Determine file source
                let fileSource;
                if (imageUrl.startsWith('http')) {
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
                if (!fileSource) {
                    // Fallback to text only if image fails? Or Error?
                    console.warn(`[TelegramClient] Image source invalid: ${imageUrl}. Sending text only.`);
                    result = await client.sendMessage(entity, { message: text });
                }
                else {
                    // Send message with media
                    result = await client.sendMessage(entity, {
                        message: text,
                        file: fileSource,
                        parseMode: "markdown", // check capitalization for gramjs
                    });
                }
            }
            else {
                // Text only
                result = await client.sendMessage(entity, {
                    message: text,
                    parseMode: "markdown",
                });
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
}
exports.TelegramClientService = TelegramClientService;
exports.default = new TelegramClientService();
