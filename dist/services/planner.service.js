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
    async generateSlots(weekId, projectId, start) {
        const slots = [];
        // Generate only 2 posts per week: Monday 10:00 and Thursday 18:00
        const SCHEDULE = [
            { day: 0, time: '10:00', index: 1 }, // Monday morning
            { day: 3, time: '18:00', index: 2 } // Thursday evening
        ];
        for (const slot of SCHEDULE) {
            const date = (0, date_fns_1.addDays)(start, slot.day);
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
    async saveTopics(weekId, topics) {
        const posts = await prisma.post.findMany({
            where: { week_id: weekId },
            orderBy: { topic_index: 'asc' }
        });
        const updates = posts.map((post, i) => {
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
