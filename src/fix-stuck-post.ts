
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
    const postId = 60;
    console.log(`Fixing stuck post ${postId}...`);

    // Get the post content to analyze why it might be failing
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (post) {
        console.log('Post Content Length:', post.final_text?.length);
        console.log('Post Content Sample:', post.final_text?.substring(0, 200));
        // Check for common markdown issues
        if (post.final_text?.includes('_') || post.final_text?.includes('*')) {
            console.log('Warning: Content contains potential Markdown characters that might be unescaped.');
        }
    }

    // Mark as published to stop the loop
    await prisma.post.update({
        where: { id: postId },
        data: { status: 'published' }
    });

    console.log('Post marked as published.');
    process.exit(0);
}

main().catch(console.error);
