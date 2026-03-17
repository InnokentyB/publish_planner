import { Worker, Job } from 'bullmq';
import { connection } from '../index';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import generatorService from '../../services/generator.service';
import plannerService from '../../services/planner.service';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const createPostWorker = () => {
    return new Worker('postsQueue', async (job: Job) => {
        const { projectId, theme, topic, postId, promptOverride, withImage, isBatch } = job.data;
        const post = await prisma.post.findUnique({ where: { id: postId }, include: { week: true } });

        if (!post) throw new Error(`Post ${postId} not found`);

        try {
            console.log(`[Worker - Posts] Generating post ${postId}`);
            
            // Mark as generating
            await prisma.post.update({
                where: { id: postId },
                data: { status: 'generating' }
            });

            const result = await generatorService.generatePostText(
                projectId, 
                theme, 
                topic, 
                postId, 
                promptOverride, 
                withImage
            );

            let fullText = result.text;
            if (result.tags && result.tags.length > 0) {
                fullText += '\n\n' + result.tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
            } else if (post.category) { 
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
                     await plannerService.updateWeekStatus(post.week_id, 'generated');
                 }
            }

        } catch (error: any) {
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
        connection: require('../index').connectionOptions,
        concurrency: 2 // Max 2 concurrent post generations across all queues to prevent heavy limits
    });
};
