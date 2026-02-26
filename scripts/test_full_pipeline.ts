import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import multiAgentService from '../src/services/multi_agent.service';
import generatorService from '../src/services/generator.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runTest() {
    try {
        console.log("Starting full image pipeline test...");
        const projectId = 1; // Assuming 1 exists
        const testText = "This is a test post about artificial intelligence in coffee making.";
        const testTopic = "AI Coffee";

        console.log("1. Testing Critic settings fetch...");
        const criticConfig = await multiAgentService.getAgentConfig(projectId, 'image_critic' as any);
        console.log(`[OK] Critic configured. Prompt length: ${criticConfig.prompt?.length || 0}`);

        console.log("2. Generating base DALL-E image...");
        const baseImagePrompt = "A robotic barista serving espresso, digital art.";
        const dalleUrl = await generatorService.generateImage(baseImagePrompt);
        console.log(`[OK] DALL-E image generated: ${dalleUrl}`);

        console.log("3. Running Image Critic...");
        const criticResult = await multiAgentService.runImageCritic(projectId, testText, dalleUrl);
        console.log(`[OK] Critic result:`, criticResult);

        let safePrompt = criticResult?.new_prompt || (criticResult as any)?.prompt;
        if (!safePrompt || safePrompt.trim() === '') {
            console.log("[WARNING] Critic returned empty prompt, using fallback.");
            safePrompt = `A highly detailed illustration for: ${testTopic}`;
        }
        console.log(`[OK] Refined prompt for Nano: ${safePrompt}`);

        console.log("4. Running Nano Banana (Image-to-Image / Fallback)...");
        const nanoUrl = await generatorService.generateImageNanoBanana(safePrompt, dalleUrl);
        console.log(`[OK] Nano Banana image generated: ${nanoUrl}`);

        console.log("Full pipeline test completed successfully!");
    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

runTest();
