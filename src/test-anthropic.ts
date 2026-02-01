import multiAgentService from './services/multi_agent.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testAnthropic() {
    console.log('--- Starting Anthropic Verification ---');

    console.log('Running generation with Anthropic keys for Creator/Fixer...');

    // We assume the keys are already set in DB by the previous execution of set-anthropic-keys.ts
    // Creator: Anthropic
    // Critic: OpenAI (Default gpt-4o)
    // Fixer: Anthropic

    try {
        const result = await multiAgentService.runPostGeneration('AI Trends 2026', 'Why coding agents are the future');
        console.log('Generation finished successfully!');
        console.log('Final Score:', result.score);
        console.log('Iterations:', result.iterations);
        console.log('Final Text Length:', result.finalText.length);
        console.log('Preview:', result.finalText.substring(0, 200));

        if (result.finalText.length > 100) {
            console.log('✅ SUCCESS: Content generated via Anthropic (presumably) without crashing.');
        } else {
            console.log('❌ FAIL: Empty content generated.');
        }

    } catch (e: any) {
        console.log('❌ FAILED with error:');
        console.error(e);
    }
}

testAnthropic()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
