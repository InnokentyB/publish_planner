import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import multiAgentService from './services/multi_agent.service';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setGeminiKey() {
    const KEY = 'AIza-PLACEHOLDER';

    console.log('Setting key for Post Critic (Gemini)...');

    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_CRITIC_KEY },
        update: { value: KEY },
        create: { key: multiAgentService.KEY_POST_CRITIC_KEY, value: KEY }
    });
    // Set model to gemini-1.5-flash
    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_CRITIC_MODEL },
        update: { value: 'gemini-2.0-flash' },
        create: { key: multiAgentService.KEY_POST_CRITIC_MODEL, value: 'gemini-2.0-flash' }
    });

    console.log('Gemini key and model set successfully.');
}

setGeminiKey()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
