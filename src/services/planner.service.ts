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

    async getWeekRangeForDate(date: Date) {
        const start = startOfWeek(date, { weekStartsOn: 1 });
        const end = endOfWeek(date, { weekStartsOn: 1 });
        return { start, end };
    }

    async createWeek(projectId: number, theme: string, start: Date, end: Date) {
        return prisma.week.create({
            data: {
                project_id: projectId,
                theme,
                week_start: start,
                week_end: end,
                status: 'planning', // Initial status, will move to topics_generated shortly
            },
        });
    }

    async generateSlots(weekId: number, projectId: number, start: Date) {
        const slots = [];

        // Generate only 2 posts per week: Monday 10:00 and Thursday 18:00
        const SCHEDULE = [
            { day: 0, time: '10:00', index: 1 }, // Monday morning
            { day: 3, time: '18:00', index: 2 }  // Thursday evening
        ];

        for (const slot of SCHEDULE) {
            const date = addDays(start, slot.day);
            const [hours, minutes] = slot.time.split(':').map(Number);

            const publishAt = new Date(date);
            publishAt.setHours(hours, minutes, 0, 0);

            slots.push({
                project_id: projectId,
                week_id: weekId,
                // channel_id: null, // Now assigned manually or to default
                slot_date: date,
                slot_index: slot.index,
                publish_at: publishAt,
                topic_index: slot.index, // 1 or 2
                status: 'planned'
            });
        }

        // Bulk insert
        await prisma.post.createMany({
            data: slots
        });
    }

    async findWeekByDate(projectId: number, date: Date) {
        return prisma.week.findFirst({
            where: {
                project_id: projectId,
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
