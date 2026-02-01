import multiAgentService from './services/multi_agent.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testGemini() {
    console.log('--- Starting Gemini Verification ---');

    console.log('Running generation with keys:');
    console.log('Creator & Fixer: Anthropic (claude-3-haiku-20240307)');
    console.log('Critic: Gemini (gemini-1.5-flash)');

    // We assume the keys are already set in DB by previous scripts

    try {
        const result = await multiAgentService.runPostGeneration('Web Development', 'Why TypeScript is Essential in 2026');
        console.log('Generation finished successfully!');
        console.log('Final Score:', result.score);
        console.log('Iterations:', result.iterations);

        // Inspect history to see if critique looks valid
        if (result.history.length > 0) {
            console.log('First Critique:', JSON.stringify(result.history[0].critique));
            if (result.history[0].critique && result.history[0].critique.length > 10) {
                console.log('✅ SUCCESS: Gemini Critic returned a critique.');
            } else {
                console.log('❌ FAIL: Empty or invalid critique from Gemini.');
            }
        }

    } catch (e: any) {
        console.log('❌ FAILED with error:');
        console.error(e);
    }
}

testGemini()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
