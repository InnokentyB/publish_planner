"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const publisher_service_1 = __importDefault(require("./services/publisher.service"));
const telegram_service_1 = __importDefault(require("./services/telegram.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
// Helper to mock without Jest
function mockTelegram() {
    // @ts-ignore
    telegram_service_1.default.sendPhoto = async (chatId, photo, extra) => {
        console.log(`[MOCK] sendPhoto to ${chatId}`);
        console.log(`  Caption Length: ${extra?.caption?.length}`);
        console.log(`  Caption Start: "${extra?.caption?.substring(0, 50)}..."`);
        if (extra?.caption?.length > 50) {
            console.log(`  Caption End: "...${extra?.caption?.substring(extra?.caption?.length - 50)}"`);
        }
        return { message_id: 123 };
    };
    // @ts-ignore
    telegram_service_1.default.sendMessage = async (chatId, text, extra) => {
        console.log(`[MOCK] sendMessage to ${chatId}`);
        console.log(`  Text Length: ${text.length}`);
        console.log(`  Text Start: "${text.substring(0, 50)}..."`);
        return { message_id: 124 };
    };
}
async function runManualCheck() {
    mockTelegram();
    const connectionString = process.env.DATABASE_URL;
    const pool = new pg_1.Pool({ connectionString });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const prisma = new client_1.PrismaClient({ adapter });
    try {
        console.log('Creating test posts in DB...');
        // Ensure channel exists
        let channel = await prisma.socialChannel.findFirst({ where: { type: 'telegram' } });
        if (!channel) {
            console.log('Creating dummy channel...');
            channel = await prisma.socialChannel.create({
                data: {
                    project_id: 1,
                    type: 'telegram',
                    name: 'Test Channel',
                    config: { telegram_channel_id: '-100123456789' }
                }
            });
        }
        // 1. Short Post
        const shortPost = await prisma.post.create({
            data: {
                project_id: 1,
                week_id: (await prisma.week.findFirst())?.id || 1,
                channel_id: channel.id,
                status: 'scheduled',
                publish_at: new Date(),
                slot_date: new Date(),
                slot_index: 0,
                topic_index: 0,
                topic: 'Test Short Post',
                final_text: 'Short text verified.',
                image_url: 'https://via.placeholder.com/150'
            }
        });
        console.log(`\n--- Processing Short Post: ${shortPost.id} ---`);
        await publisher_service_1.default.publishPostNow(shortPost.id);
        // 2. Long Post
        // Create text that is > 1024 chars.
        // We want to see if it splits correctly at newline or space.
        const part1 = 'A'.repeat(1000);
        const part2 = 'B'.repeat(100);
        const longText = part1 + '\n' + part2; // Total 1101 chars. Newline at 1000.
        const longPost = await prisma.post.create({
            data: {
                project_id: 1,
                week_id: (await prisma.week.findFirst())?.id || 1,
                channel_id: channel.id,
                status: 'scheduled',
                publish_at: new Date(),
                slot_date: new Date(),
                slot_index: 0,
                topic_index: 0,
                topic: 'Test Long Post',
                final_text: longText,
                image_url: 'https://via.placeholder.com/150'
            }
        });
        console.log(`\n--- Processing Long Post: ${longPost.id} ---`);
        await publisher_service_1.default.publishPostNow(longPost.id);
        // Cleanup
        await prisma.post.delete({ where: { id: shortPost.id } });
        await prisma.post.delete({ where: { id: longPost.id } });
        console.log('\nCleanup done.');
    }
    catch (e) {
        console.error(e);
    }
    finally {
        await prisma.$disconnect();
    }
}
runManualCheck();
