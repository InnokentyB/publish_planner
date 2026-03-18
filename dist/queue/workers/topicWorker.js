"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTopicWorker = void 0;
const bullmq_1 = require("bullmq");
const index_1 = require("../index");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const planner_service_1 = __importDefault(require("../../services/planner.service"));
const generator_service_1 = __importDefault(require("../../services/generator.service"));
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const createTopicWorker = () => {
    return new bullmq_1.Worker('topicsQueue', async (job) => {
        const { projectId, weekId, promptOverride, countToGenerate, existingCount, existingTopics } = job.data;
        const week = await prisma.week.findUnique({ where: { id: weekId } });
        if (!week)
            throw new Error('Week not found during worker execution');
        try {
            console.log(`[Worker - Topics] Generating ${countToGenerate} topics for week ${weekId}`);
            // Mark as generating
            await planner_service_1.default.updateWeekStatus(weekId, 'generating');
            // Generate Topics via service
            const result = await generator_service_1.default.generateTopics(projectId, week.theme, weekId, promptOverride, countToGenerate, existingTopics);
            // Save generated topics
            await planner_service_1.default.saveTopics(weekId, result.topics, existingCount);
            // Revert status to topics_generated, handled inside plannerService typically, but explicitly:
            await planner_service_1.default.updateWeekStatus(weekId, 'topics_generated');
            console.log(`[Worker - Topics] Handled generation for week ${weekId} successfully.`);
        }
        catch (error) {
            console.error(`[Worker - Topics] Job failed:`, error);
            // Mark week as having failed topic generation
            await prisma.week.update({
                where: { id: weekId },
                data: { status: 'failed_topics' } // New status or fallback 
            });
            throw error; // Will be caught by BullMQ for retries/DLQ
        }
    }, {
        connection: index_1.connection,
        concurrency: 1 // Rate limiting topics generation (usually hits heavy models)
    });
};
exports.createTopicWorker = createTopicWorker;
