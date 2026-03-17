"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createImageWorker = void 0;
const bullmq_1 = require("bullmq");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const generator_service_1 = __importDefault(require("../../services/generator.service"));
const multi_agent_service_1 = __importDefault(require("../../services/multi_agent.service"));
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const createImageWorker = () => {
    return new bullmq_1.Worker('imageQueue', async (job) => {
        const { projectId, postId, provider, textToUse, topic } = job.data;
        const post = await prisma.post.findUnique({ where: { id: postId } });
        if (!post)
            throw new Error(`Post ${postId} not found`);
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
            const imagePrompt = await multi_agent_service_1.default.runImagePromptingChain(projectId, textToUse, topic || 'Tech Post');
            console.log(`[Worker - Image] Generated prompt: ${imagePrompt.substring(0, 50)}...`);
            // 2. Generate Image
            let imageUrl = '';
            safePrompt = imagePrompt;
            if (!safePrompt || safePrompt.trim().length === 0) {
                console.warn('[Worker - Image] Fallback triggered: imagePrompt was empty');
                safePrompt = `A professional vector illustration for a tech blog post about: ${topic || 'Technology'}. Minimalist style.`;
            }
            if (provider === 'nano') {
                imageUrl = await generator_service_1.default.generateImageNanoBanana(safePrompt);
            }
            else if (provider === 'full') {
                const dalleUrl = await generator_service_1.default.generateImage(safePrompt);
                const criticResult = await multi_agent_service_1.default.runImageCritic(projectId, textToUse, dalleUrl);
                if (!criticResult)
                    throw new Error("Critic failed to generate feedback.");
                safePrompt = criticResult.new_prompt || criticResult.prompt || `A highly detailed image about: ${topic}`;
                if (!safePrompt || typeof safePrompt !== 'string' || safePrompt.trim() === '') {
                    safePrompt = `A professional illustration for: ${topic}`;
                }
                imageUrl = await generator_service_1.default.generateImageNanoBanana(safePrompt, dalleUrl);
            }
            else {
                imageUrl = await generator_service_1.default.generateImage(safePrompt);
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
        }
        catch (error) {
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
exports.createImageWorker = createImageWorker;
