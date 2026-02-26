"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const publisher_service_1 = __importDefault(require("./services/publisher.service"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    console.log('Testing long message splitting...');
    // 1. Create a dummy long post
    const longText = 'Start' + '\nLine\n'.repeat(500) + 'End (Total chars: ' + (500 * 5 + 10) + ')';
    // This is ~2500 chars. Let's make it longer to trigger > 4096.
    const veryLongText = 'START_LONG_POST\n' + 'A'.repeat(4200) + '\nEND_LONG_POST';
    console.log(`Creating post with ${veryLongText.length} chars...`);
    const week = await prisma.week.findFirst();
    if (!week) {
        console.error('No week found');
        return;
    }
    const post = await prisma.post.create({
        data: {
            project_id: week.project_id,
            week_id: week.id,
            channel_id: null,
            slot_date: new Date(),
            slot_index: 999,
            publish_at: new Date(), // Now
            topic_index: 999,
            topic: 'TEST LONG POST',
            status: 'scheduled',
            final_text: veryLongText
        }
    });
    console.log(`Created test post ${post.id}. Attempting to publish...`);
    try {
        await publisher_service_1.default.publishDuePosts();
        console.log('Publish call finished.');
        // Check status
        const updated = await prisma.post.findUnique({ where: { id: post.id } });
        console.log(`Post status after publish: ${updated?.status}`);
    }
    catch (e) {
        console.error('Error during publish:', e);
    }
    finally {
        // Cleanup
        await prisma.post.delete({ where: { id: post.id } });
        console.log('Cleaned up test post.');
        process.exit(0);
    }
}
main().catch(console.error);
