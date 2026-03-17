import { Worker, Job } from 'bullmq';
import { connection } from '../index';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import generatorService from '../../services/generator.service';
import multiAgentService from '../../services/multi_agent.service';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const createImageWorker = () => {
    return new Worker('imageQueue', async (job: Job) => {
        const { projectId, postId, provider, textToUse, topic } = job.data;
        const post = await prisma.post.findUnique({ where: { id: postId } });

        if (!post) throw new Error(`Post ${postId} not found`);

        let safePrompt = '';
        try {
            console.log(`[Worker - Image] Starting image generation for post ${postId}`);

            // Mark post as generating image
            await prisma.post.update({
                where: { id: postId },
                data: { status: 'generating' } // Reusing generating status for UX
            });

            // 1. Generate Prompt (Multi-Agent Chain)
            console.log(`[Worker - Image] Generating prompt via Multi-Agent Chain...`);
            const imagePrompt = await multiAgentService.runImagePromptingChain(projectId, textToUse, topic || 'Tech Post');
            console.log(`[Worker - Image] Generated prompt: ${imagePrompt.substring(0, 50)}...`);

            // 2. Generate Image
            let imageUrl = '';
            
            safePrompt = imagePrompt;
            if (!safePrompt || safePrompt.trim().length === 0) {
                console.warn('[Worker - Image] Fallback triggered: imagePrompt was empty');
                safePrompt = `A professional vector illustration for a tech blog post about: ${topic || 'Technology'}. Minimalist style.`;
            }

            if (provider === 'nano') {
                imageUrl = await generatorService.generateImageNanoBanana(safePrompt);
            } else if (provider === 'full') {
                const dalleUrl = await generatorService.generateImage(safePrompt);
                const criticResult = await multiAgentService.runImageCritic(projectId, textToUse, dalleUrl);
                
                if (!criticResult) throw new Error("Critic failed to generate feedback.");
                safePrompt = criticResult.new_prompt || (criticResult as any).prompt || `A highly detailed image about: ${topic}`;

                if (!safePrompt || typeof safePrompt !== 'string' || safePrompt.trim() === '') {
                    safePrompt = `A professional illustration for: ${topic}`;
                }

                imageUrl = await generatorService.generateImageNanoBanana(safePrompt, dalleUrl);
            } else {
                imageUrl = await generatorService.generateImage(safePrompt);
            }

            // 3. Save to DB
            await prisma.post.update({
                where: { id: postId },
                data: {
                    image_url: imageUrl,
                    image_prompt: safePrompt,
                    status: 'generated' // Return post to ready state
                }
            });

            console.log(`[Worker - Image] Successfully generated image for post ${postId}`);

        } catch (error: any) {
            console.error(`[Worker - Image] Job failed for post ${postId}:`, error);
            const errMsg = error?.message || error?.toString() || '';

            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: 'failed',
                    image_prompt: `[Image Gen Failed]\nError: ${errMsg}`
                }
            });

            throw error;
        }
    }, {
        connection: require('../index').connectionOptions,
        concurrency: 1 // Images strictly 1 concurrent job to avoid 429 rate limit
    });
};
