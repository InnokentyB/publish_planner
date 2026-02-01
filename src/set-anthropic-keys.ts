import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import multiAgentService from './services/multi_agent.service';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setKeys() {
    const KEY = 'sk-ant-PLACEHOLDER';

    console.log('Setting keys for Post Creator and Post Fixer...');

    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_CREATOR_KEY },
        update: { value: KEY },
        create: { key: multiAgentService.KEY_POST_CREATOR_KEY, value: KEY }
    });
    // Create prompt for Creator model if not exists, default to claude-3-5-sonnet-20241022
    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_CREATOR_MODEL },
        update: { value: 'claude-3-haiku-20240307' },
        create: { key: multiAgentService.KEY_POST_CREATOR_MODEL, value: 'claude-3-haiku-20240307' }
    });

    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_FIXER_KEY },
        update: { value: KEY },
        create: { key: multiAgentService.KEY_POST_FIXER_KEY, value: KEY }
    });
    // Create prompt for Fixer model if not exists
    await prisma.promptSettings.upsert({
        where: { key: multiAgentService.KEY_POST_FIXER_MODEL },
        update: { value: 'claude-3-haiku-20240307' },
        create: { key: multiAgentService.KEY_POST_FIXER_MODEL, value: 'claude-3-haiku-20240307' }
    });

    console.log('Keys and models set successfully.');
}

setKeys()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
