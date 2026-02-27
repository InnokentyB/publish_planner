import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { PrismaClient } from "@prisma/client";
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class TelegramClientService {
    private client: TelegramClient | null = null;
    private sessionString: string = "";
    private apiId: number = 0;
    private apiHash: string = "";
    private phoneNumber: string = "";

    constructor() { }

    /**
     * Initialize client with data from DB for a specific project
     */
    async init(projectId: number = 1) {
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
            this.client = new TelegramClient(
                new StringSession(this.sessionString),
                this.apiId,
                this.apiHash,
                { connectionRetries: 5 }
            );

            // Connect without login if session is valid? 
            // Actually connect() does not trigger interactive login if session is present.
            await this.client.connect();
            console.log(`[TelegramClient] Connected as ${this.phoneNumber}`);
            return true;
        } catch (e) {
            console.error(`[TelegramClient] Failed to connect:`, e);
            return false;
        }
    }

    async getClient(projectId: number = 1): Promise<TelegramClient | null> {
        if (!this.client) {
            const success = await this.init(projectId);
            if (!success) return null;
        }
        return this.client;
    }

    /**
     * Publish a post to a channel/chat
     * @param target which could be a username, phone number, or chat ID
     */
    async publishPost(projectId: number, target: string | number, text: string, imageUrl?: string | null, scheduleDate?: Date) {
        const client = await this.getClient(projectId);
        if (!client) {
            throw new Error("Telegram Client not initialized or no account found.");
        }

        // Resolve target if it's a string ID like "-100123..."
        let entity: any = target;
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
                } catch (e) {
                    // If failed, and it looks like an ID, try as generic input (gram.js usually parses strings ok)
                    if (/^-?\d+$/.test(target)) {
                        // Some versions want types.long or BigInt, but native bigint can mismatch types.
                        // We try passing as string or number if within safe range, or any-cast if needed.
                        try {
                            entity = await client.getEntity(target);
                        } catch (e2) {
                            // Last resort, cast to any to try native bigint or specialized type
                            // @ts-ignore
                            entity = await client.getEntity(BigInt(target));
                        }
                    }
                }
            } else {
                entity = await client.getEntity(target);
            }
        } catch (e) {
            console.error(`[TelegramClient] Failed to resolve entity ${target}:`, e);
            throw new Error(`Could not access channel: ${target}`);
        }

        let tempFilePath: string | undefined;

        try {
            let result;

            if (imageUrl) {
                // Determine file source
                let fileSource: any;
                if (imageUrl.startsWith('data:')) {
                    const base64Data = imageUrl.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');
                    tempFilePath = path.join(__dirname, '../../uploads', `temp_${Date.now()}.jpg`);
                    fs.writeFileSync(tempFilePath, buffer);
                    fileSource = tempFilePath;
                } else if (imageUrl.startsWith('http')) {
                    fileSource = imageUrl; // GramJS can sometimes handle URLs, but often better to download buffer
                    // For now let implementation handle URL if library supports, else we might need to download
                } else if (imageUrl.startsWith('/uploads/')) {
                    const filename = imageUrl.split('/').pop();
                    const localPath = path.join(__dirname, '../../uploads', filename || '');
                    if (fs.existsSync(localPath)) {
                        fileSource = localPath; // Uploading local path works in gramjs
                    }
                }

                let scheduleTime: number | undefined;
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
                } else {
                    // Send message with media
                    result = await client.sendMessage(entity, {
                        message: text,
                        file: fileSource,
                        parseMode: "markdown",
                        schedule: scheduleTime
                    });
                }

            } else {
                // Text only
                let scheduleTime: number | undefined;
                if (scheduleDate) {
                    scheduleTime = Math.floor(scheduleDate.getTime() / 1000);
                }

                result = await client.sendMessage(entity, {
                    message: text,
                    parseMode: "markdown",
                    schedule: scheduleTime
                });
            }

            return result;
        } catch (e: any) {
            console.error(`[TelegramClient] Publish error:`, e);

            if (e.seconds) {
                // FloodWaitError handling
                throw new Error(`FLOOD_WAIT_${e.seconds}`); // Throw specific error to be caught by caller
            }
            throw e;
        } finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (cleanupErr) {
                    console.error(`[TelegramClient] Failed to cleanup temp file:`, cleanupErr);
                }
            }
        }
    }

    // Helper to generate session string (login flow)
    static async generateSession(apiId: number, apiHash: string, phone: string, codeCb: () => Promise<string>, passwordCb: () => Promise<string>): Promise<string> {
        const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
        await client.start({
            phoneNumber: phone,
            password: async () => await passwordCb(),
            phoneCode: async () => await codeCb(),
            onError: (err) => console.log(err),
        });
        const session = client.session.save() as unknown as string; // Casting because return type might be mismatched in types
        await client.disconnect();
        return session;
    }
}

export default new TelegramClientService();
