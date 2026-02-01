import multiAgentService from './services/multi_agent.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testConfig() {
    console.log('--- Starting Config Verification ---');

    // 1. Set a "BAD" API Key for the Critic to ensure it falls (proving it uses the custom key)
    const badKey = 'sk-proj-INVALID-KEY-FOR-TESTING-12345';
    console.log(`Setting Post Critic Key to: ${badKey}`);

    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_CRITIC_KEY },
        update: { value: badKey },
        create: { key: multiAgentService.KEY_POST_CRITIC_KEY, value: badKey }
    });

    console.log('Running generation...');
    try {
        const result = await multiAgentService.runPostGeneration(1, 'Test Theme', 'Test Topic for Config Check');
        console.log('Generation finished (Unexpected success given bad key)');
        console.log('Score:', result.score);
    } catch (e: any) {
        console.log('Caught expected error during generation:');
        // We expect an error from OpenAI about invalid key
        if (e?.message?.includes('Incorrect API key') || e?.status === 401) {
            console.log('✅ SUCCESS: Caught "Incorrect API key" error. This confirms the custom key was used.');
        } else {
            console.log('❓ Caught different error:', e.message);
            console.log(e);
        }
    } finally {
        // Cleanup: Remove the bad key
        console.log('Cleaning up...');
        await prisma.promptSettings.delete({
            where: { key: multiAgentService.KEY_POST_CRITIC_KEY }
        });
        console.log('Cleanup done.');
    }
}

testConfig()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
