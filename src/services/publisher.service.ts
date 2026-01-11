import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import telegramService from './telegram.service';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class PublisherService {
    async publishDuePosts() {
        const now = new Date();

        // Find all scheduled posts that are due
        const duePosts = await prisma.post.findMany({
            where: {
                status: 'scheduled',
                publish_at: { lte: now }
            },
            include: {
                week: true
            }
        });

        console.log(`Found ${duePosts.length} posts due for publishing.`);

        for (const post of duePosts) {
            try {
                // Get the channel for this post
                const channel = await prisma.channel.findUnique({
                    where: { id: post.channel_id }
                });

                if (!channel || !channel.telegram_channel_id) {
                    console.error(`Channel not found or telegram_channel_id missing for post ${post.id}`);
                    continue;
                }

                // Send to Telegram
                // Note: telegram_channel_id is stored as BigInt in DB, needs to be converted or used as string
                const targetChannelId = channel.telegram_channel_id.toString();

                await telegramService.sendMessage(targetChannelId, post.final_text || post.generated_text || '');

                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'published' }
                });

                console.log(`Successfully published post ${post.id} to channel ${targetChannelId}`);
            } catch (err) {
                console.error(`Failed to publish post ${post.id}:`, err);
            }
        }

        return duePosts.length;
    }
}

export default new PublisherService();
