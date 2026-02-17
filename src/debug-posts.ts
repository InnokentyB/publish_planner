import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Checking for stuck posts...');
    const now = new Date();

    const duePosts = await prisma.post.findMany({
        where: {
            status: { in: ['scheduled', 'scheduled_native'] },
            publish_at: { lte: now }
        },
        include: { week: true }
    });

    console.log(`Found ${duePosts.length} due posts.`);

    for (const post of duePosts) {
        console.log(`\nPost ID: ${post.id}`);
        console.log(`Topic: ${post.topic}`);
        console.log(`Status: ${post.status}`);
        console.log(`Publish At: ${post.publish_at}`);
        console.log(`Image URL: ${post.image_url ? post.image_url.substring(0, 50) + '...' : 'None'}`);
    }

    console.log('\nChecking for duplicates (posts with same topic/image)...');
    // Group by topic
    const posts = await prisma.post.findMany({
        orderBy: { id: 'desc' },
        take: 100
    });

    const topicCounts: Record<string, number> = {};
    posts.forEach((p: any) => {
        if (p.topic) {
            topicCounts[p.topic] = (topicCounts[p.topic] || 0) + 1;
        }
    });

    Object.entries(topicCounts).forEach(([topic, count]) => {
        if (count > 1) {
            console.log(`Warning: Topic "${topic}" appears ${count} times.`);
        }
    });

    process.exit(0);
}

main().catch(console.error);
