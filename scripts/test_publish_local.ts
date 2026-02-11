
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import publisherService from '../src/services/publisher.service';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function test() {
    try {
        // 1. Find a telegram channel
        const channel = await prisma.socialChannel.findFirst({
            where: { type: 'telegram' }
        });

        if (!channel) {
            console.error('No telegram channel found');
            return;
        }

        console.log('Using channel:', channel.name, channel.id);

        // 2. Create a test post
        // We need a valid week and project.
        const project = await prisma.project.findFirst();
        if (!project) throw new Error('No project found');

        const week = await prisma.week.create({
            data: {
                project_id: project.id,
                theme: 'Test Publish',
                week_start: new Date(),
                week_end: new Date(),
                status: 'planning'
            }
        });

        const post = await prisma.post.create({
            data: {
                project_id: project.id,
                week_id: week.id,
                channel_id: channel.id,
                slot_date: new Date(),
                slot_index: 0,
                publish_at: new Date(),
                topic_index: 0,
                topic: 'Test Local Image Publish',
                image_url: '/uploads/test-image.png', // This value must match the one we verified earlier
                final_text: 'This is a test post confirming local image publishing.',
                status: 'scheduled'
            }
        });

        console.log('Created test post:', post.id);

        // 3. Publish
        await publisherService.publishPostNow(post.id);
        console.log('Published successfully!');

        // Cleanup
        await prisma.post.delete({ where: { id: post.id } });
        await prisma.week.delete({ where: { id: week.id } });

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

test();
