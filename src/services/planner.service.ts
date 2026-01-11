import { PrismaClient, Post } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { addDays, nextMonday, nextSunday, format, startOfWeek, endOfWeek } from 'date-fns';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class PlannerService {
    async getCurrentWeekRange() {
        const today = new Date();
        const start = startOfWeek(today, { weekStartsOn: 1 }); // Monday
        const end = endOfWeek(start, { weekStartsOn: 1 }); // Sunday
        return { start, end };
    }

    async getNextWeekRange() {
        const today = new Date();
        const start = nextMonday(today);
        const end = nextSunday(start);
        return { start, end };
    }

    async createWeek(channelId: number, theme: string, start: Date, end: Date) {
        return prisma.week.create({
            data: {
                channel_id: channelId,
                theme,
                week_start: start,
                week_end: end,
                status: 'planning', // Initial status, will move to topics_generated shortly
            },
        });
    }

    async generateSlots(weekId: number, channelId: number, start: Date) {
        const slots = [];
        const SLOT_TIMES = [
            { index: 1, time: '10:00' },
            { index: 2, time: '18:00' }
        ];

        // Create 14 slots (Mo-Su * 2)
        for (let day = 0; day < 7; day++) {
            const date = addDays(start, day);
            for (const slotTime of SLOT_TIMES) {
                const [hours, minutes] = slotTime.time.split(':').map(Number);

                // Create timestamp for publish_at relative to slot_date
                // Ideally handle timezone here (defaulting to UTC or system time for MVP)
                const publishAt = new Date(date);
                publishAt.setHours(hours, minutes, 0, 0);

                slots.push({
                    week_id: weekId,
                    channel_id: channelId,
                    slot_date: date,
                    slot_index: slotTime.index,
                    publish_at: publishAt,
                    topic_index: (day * 2) + slotTime.index, // 1..14
                    status: 'planned'
                });
            }
        }

        // Bulk insert
        await prisma.post.createMany({
            data: slots
        });
    }

    async findWeekByDate(channelId: number, date: Date) {
        return prisma.week.findFirst({
            where: {
                channel_id: channelId,
                week_start: { lte: date },
                week_end: { gte: date }
            },
            include: { posts: { orderBy: { topic_index: 'asc' } } }
        });
    }

    async updateWeekStatus(weekId: number, status: string) {
        return prisma.week.update({
            where: { id: weekId },
            data: { status }
        });
    }

    async saveTopics(weekId: number, topics: { topic: string, category: string, tags: string[] }[]) {
        const posts = await prisma.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });

        const updates = posts.map((post: Post, i: number) => {
            if (topics[i]) {
                return prisma.post.update({
                    where: { id: post.id },
                    data: {
                        topic: topics[i].topic,
                        category: topics[i].category,
                        tags: topics[i].tags,
                        status: 'topics_generated'
                    }
                });
            }
            return Promise.resolve();
        });

        await Promise.all(updates);
        await this.updateWeekStatus(weekId, 'topics_generated');
    }

    async getWeekPosts(weekId: number) {
        return prisma.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });
    }

    async getPostById(postId: number) {
        return prisma.post.findUnique({
            where: { id: postId },
            include: { week: true }
        });
    }

    async updatePost(postId: number, data: any) {
        return prisma.post.update({
            where: { id: postId },
            data
        });
    }
}

export default new PlannerService();
