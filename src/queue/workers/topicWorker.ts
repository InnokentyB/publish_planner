import { Worker, Job } from 'bullmq';
import { connection } from '../index';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import plannerService from '../../services/planner.service';
import generatorService from '../../services/generator.service';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const createTopicWorker = () => {
    return new Worker('topicsQueue', async (job: Job) => {
        const { projectId, weekId, promptOverride, countToGenerate, existingCount, existingTopics } = job.data;
        const week = await prisma.week.findUnique({ where: { id: weekId } });

        if (!week) throw new Error('Week not found during worker execution');

        try {
            console.log(`[Worker - Topics] Generating ${countToGenerate} topics for week ${weekId}`);
            
            // Mark as generating
            await plannerService.updateWeekStatus(weekId, 'generating');

            // Generate Topics via service
            const result = await generatorService.generateTopics(
                projectId, 
                week.theme, 
                weekId, 
                promptOverride, 
                countToGenerate, 
                existingTopics
            );

            // Save generated topics
            await plannerService.saveTopics(weekId, result.topics, existingCount);
            
            // Revert status to topics_generated, handled inside plannerService typically, but explicitly:
            await plannerService.updateWeekStatus(weekId, 'topics_generated');
            console.log(`[Worker - Topics] Handled generation for week ${weekId} successfully.`);

        } catch (error: any) {
            console.error(`[Worker - Topics] Job failed:`, error);
            
            // Mark week as having failed topic generation
            await prisma.week.update({
                where: { id: weekId },
                data: { status: 'failed_topics' } // New status or fallback 
            });

            throw error; // Will be caught by BullMQ for retries/DLQ
        }
    }, {
        connection: connection as any,
        concurrency: 1 // Rate limiting topics generation (usually hits heavy models)
    });
};
