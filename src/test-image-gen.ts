
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import generatorService from './services/generator.service';
import plannerService from './services/planner.service';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testImageGen() {
    try {
        console.log('--- Starting Image Generation Test ---');

        // 1. Find a valid post to test with
        console.log('Finding a recent post...');
        const post = await prisma.post.findFirst({
            where: {
                project_id: { not: undefined } // Ensure we have a project associated
            },
            include: { week: true },
            orderBy: { created_at: 'desc' }
        });

        if (!post) {
            console.error('No posts found to test with.');
            return;
        }
        console.log(`Found post ID: ${post.id}, Project ID: ${post.project_id}`);

        // 2. Generate Prompt (Mocking or real)
        console.log('Generating image prompt...');
        // We use the service to ensure the valid logic (checking project settings etc)
        // Using a short text override to avoid massive context
        const prompt = await generatorService.generateImagePrompt(
            post.project_id,
            post.topic || 'Test Topic',
            'This is a test post content for verifying image generation.',
            'gpt-image'
        );
        console.log('Generated Prompt:', prompt);

        if (!prompt) {
            throw new Error('Prompt generation returned empty string');
        }

        // 3. Generate Image (Real call to DALL-E or Nano to verify API connection)
        // 3. Generate Image (Real call to GPT-Image or Nano to verify API connection)
        // NOTE: This costs money/credits. If we want to skip, we can mock.
        // But the user asked to "run the generation", so we should probably do a real call or at least the Nano one if set up.
        // Let's rely on the user's config. defaulting to GPT-Image as per their previous errors.
        console.log('Generating image (using Nano/Gemini if configured to save GPT-Image credits, otherwise GPT-Image)...');

        // Let's try to use Nano/Gemini first if key exists, as it's cheaper/free-tier usually, 
        // OR just use GPT-Image if that's        console.log(`\n\n=== 3. Requesting Image from GPT-Image ===`);
        // We use the same service the actual app uses to ensure parity.
        try {
            // OR just use GPT-Image if that's what they are using in production.
            // I will use GPT-Image as that matches the user's context.

            console.log(`Generating image for Prompt: "${prompt.substring(0, 50)}..."`);
            const imageUrl = await generatorService.generateImage(prompt);
            console.log(`✅ Success! Image URL: ${imageUrl}`);
        } catch (e: any) {
            console.error(`❌ Failed to generate image via GPT-Image:`, e.message);
        }
        let imageUrl = `https://example.com/test-image-${Date.now()}.png`;

        // 4. Save to DB (The Critical Failure Point)
        console.log('Attempting to save to DB (The Critical Step)...');
        await plannerService.updatePost(post.id, {
            image_url: imageUrl,
            image_prompt: prompt
        });

        // 5. Verify Persistence
        console.log('Verifying data in DB...');
        const updatedPost = await prisma.post.findUnique({
            where: { id: post.id }
        });

        if (updatedPost?.image_prompt === prompt) {
            console.log('SUCCESS: image_prompt was saved correctly!');
            console.log('Saved Prompt:', updatedPost.image_prompt);
        } else {
            console.error('FAILURE: image_prompt did NOT match or was not saved.');
            console.error('Expected:', prompt);
            console.error('Actual:', updatedPost?.image_prompt);
        }

    } catch (error) {
        console.error('TEST FAILED:', error);
    } finally {
        await prisma.$disconnect();
    }
}

testImageGen();
