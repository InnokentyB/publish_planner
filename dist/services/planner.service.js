"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const date_fns_1 = require("date-fns");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class PlannerService {
    async getCurrentWeekRange() {
        const today = new Date();
        const start = (0, date_fns_1.startOfWeek)(today, { weekStartsOn: 1 }); // Monday
        const end = (0, date_fns_1.endOfWeek)(start, { weekStartsOn: 1 }); // Sunday
        return { start, end };
    }
    async getNextWeekRange() {
        const today = new Date();
        const start = (0, date_fns_1.nextMonday)(today);
        const end = (0, date_fns_1.nextSunday)(start);
        return { start, end };
    }
    async getWeekRangeForDate(date) {
        const start = (0, date_fns_1.startOfWeek)(date, { weekStartsOn: 1 });
        const end = (0, date_fns_1.endOfWeek)(date, { weekStartsOn: 1 });
        return { start, end };
    }
    async createWeek(projectId, theme, start, end) {
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
    async generateSlots(weekId, projectId, start, count = 14, startIndex = 0) {
        const slots = [];
        // Fetch default channel (Telegram)
        const channel = await prisma.socialChannel.findFirst({
            where: { project_id: projectId, type: 'telegram' }
        });
        const channelId = channel ? channel.id : null;
        for (let i = 0; i < count; i++) {
            // Distribute 2 slots per day for 7 days (Total 14)
            // i=0,1 -> Mon (offset 0)
            // i=2,3 -> Tue (offset 1)
            // ...
            const dayOffset = Math.floor(i / 2);
            const date = (0, date_fns_1.addDays)(start, dayOffset);
            const publishAt = new Date(date);
            // Even index = Morning (10:00), Odd index = Evening (18:00)
            const hour = i % 2 === 0 ? 10 : 18;
            publishAt.setHours(hour, 0, 0, 0);
            slots.push({
                project_id: projectId,
                week_id: weekId,
                channel_id: channelId,
                slot_date: date,
                slot_index: startIndex + i + 1,
                publish_at: publishAt,
                topic_index: startIndex + i + 1,
                status: 'planned'
            });
        }
        // Bulk insert
        if (slots.length > 0) {
            await prisma.post.createMany({
                data: slots
            });
        }
    }
    async findWeekByDate(projectId, date) {
        return prisma.week.findFirst({
            where: {
                project_id: projectId,
                week_start: { lte: date },
                week_end: { gte: date }
            },
            include: { posts: { orderBy: { topic_index: 'asc' } } }
        });
    }
    async updateWeekStatus(weekId, status) {
        return prisma.week.update({
            where: { id: weekId },
            data: { status }
        });
    }
    async saveTopics(weekId, topics, startIndex = 0) {
        const posts = await prisma.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });
        // Filter posts to only those we want to update (from startIndex)
        // Note: topic_index is 1-based usually
        const targetPosts = posts.filter(p => p.topic_index > startIndex && p.topic_index <= startIndex + topics.length);
        const updates = targetPosts.map((post, i) => {
            // i here is index in targetPosts, which matches index in topics
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
    async getWeekPosts(weekId) {
        return prisma.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });
    }
    async getPostById(postId) {
        return prisma.post.findUnique({
            where: { id: postId },
            include: { week: true }
        });
    }
    async updatePost(postId, data) {
        return prisma.post.update({
            where: { id: postId },
            data
        });
    }
}
exports.default = new PlannerService();
