
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { PrismaClient } from "@prisma/client";
import * as readline from "readline";
import { config } from "dotenv";

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

async function main() {
    console.log("=== Telegram Account Setup ===");

    const apiIdStr = await ask("Enter API ID: ");
    const apiId = parseInt(apiIdStr);
    const apiHash = await ask("Enter API Hash: ");
    const phoneNumber = await ask("Enter Phone Number (e.g. +1234567890): ");

    console.log("Connecting...");

    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: phoneNumber,
        password: async () => {
            return await ask("Enter 2FA Password (if authorized): ");
        },
        phoneCode: async () => {
            return await ask("Enter the code you received: ");
        },
        onError: (err) => console.log(err),
    });

    console.log("Connected!");

    const sessionConfig = client.session.save() as unknown as string;

    console.log("Session generated successfully.");

    // Save to DB
    const projectIdStr = await ask("Enter Project ID to associate with (default 1): ");
    const projectId = parseInt(projectIdStr) || 1;

    try {
        await prisma.telegramAccount.upsert({
            where: {
                project_id_phone_number: {
                    project_id: projectId,
                    phone_number: phoneNumber
                }
            },
            update: {
                session_string: sessionConfig,
                api_id: apiId,
                api_hash: apiHash,
                is_active: true
            },
            create: {
                project_id: projectId,
                phone_number: phoneNumber,
                session_string: sessionConfig,
                api_id: apiId,
                api_hash: apiHash,
                is_active: true
            }
        });
        console.log(`Successfully saved account for ${phoneNumber} in Project ${projectId}.`);
    } catch (e) {
        console.error("Failed to save to DB:", e);
    }

    await client.disconnect();
    process.exit(0);
}

main().catch(console.error);
