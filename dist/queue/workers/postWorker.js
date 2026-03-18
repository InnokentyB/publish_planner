"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPostWorker = void 0;
const bullmq_1 = require("bullmq");
const index_1 = require("../index");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const generator_service_1 = __importDefault(require("../../services/generator.service"));
const planner_service_1 = __importDefault(require("../../services/planner.service"));
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const createPostWorker = () => {
    return new bullmq_1.Worker('postsQueue', async (job) => {
        const { projectId, theme, topic, postId, promptOverride, withImage, isBatch } = job.data;
        const post = await prisma.post.findUnique({ where: { id: postId }, include: { week: true } });
        if (!post)
            throw new Error(`Post ${postId} not found`);
        try {
            console.log(`[Worker - Posts] Generating post ${postId}`);
            // Mark as generating
            await prisma.post.update({
                where: { id: postId },
                data: { status: 'generating' }
            });
            const result = await generator_service_1.default.generatePostText(projectId, theme, topic, postId, promptOverride, withImage);
            let fullText = result.text;
            if (result.tags && result.tags.length > 0) {
                fullText += '\n\n' + result.tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
            }
            else if (post.category) {
                fullText += `\n\n#${post.category.replace(/\s+/g, '')}`;
            }
            await prisma.post.update({
                where: { id: post.id },
                data: {
                    generated_text: fullText,
                    final_text: fullText,
                    status: 'generated',
                    category: result.category || undefined,
                    tags: result.tags || undefined
                }
            });
            console.log(`[Worker - Posts] Post ${postId} generated successfully.`);
            // If this was part of a batch week generation, check if it's the last one
            if (isBatch && post.week_id) {
                const remaining = await prisma.post.count({ where: { week_id: post.week_id, status: 'generating' } });
                if (remaining === 0) {
                    await planner_service_1.default.updateWeekStatus(post.week_id, 'generated');
                }
            }
        }
        catch (error) {
            console.error(`[Worker - Posts] Job failed for post ${postId}:`, error);
            const errMsg = error?.message || error?.toString() || '';
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: 'failed',
                    generated_text: `[Generation Failed]\nError: ${errMsg}`
                }
            });
            throw error; // Let BullMQ handle failure tracking
        }
    }, {
        connection: index_1.connection,
        concurrency: 2 // Max 2 concurrent post generations across all queues to prevent heavy limits
    });
};
exports.createPostWorker = createPostWorker;
