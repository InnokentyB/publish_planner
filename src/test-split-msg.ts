
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import telegramService from './services/telegram.service';
import publisherService from './services/publisher.service';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
            week_id: week.id,
            channel_id: 1, // Assuming channel 1 exists
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
        await publisherService.publishDuePosts();
        console.log('Publish call finished.');

        // Check status
        const updated = await prisma.post.findUnique({ where: { id: post.id } });
        console.log(`Post status after publish: ${updated?.status}`);

    } catch (e) {
        console.error('Error during publish:', e);
    } finally {
        // Cleanup
        await prisma.post.delete({ where: { id: post.id } });
        console.log('Cleaned up test post.');
        process.exit(0);
    }
}

main().catch(console.error);
