"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
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
    const topicCounts = {};
    posts.forEach((p) => {
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
