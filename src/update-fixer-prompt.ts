import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const IMPROVED_FIXER_PROMPT = `You are an expert editor. Rewrite the post to address the critique while keeping the original meaning. 

CRITICAL: Return ONLY the improved post text itself. Do NOT include:
- Any meta-commentary about what you changed
- Explanations of improvements
- Analysis of the critique
- Introductory phrases like "Here's the improved version" or "Замечательная работа"

Start directly with the post content.`;

async function updateFixerPrompt() {
    console.log('Updating Post Fixer prompt...');

    await prisma.promptSettings.upsert({
        where: { key: 'multi_agent_post_fixer_prompt' },
        update: { value: IMPROVED_FIXER_PROMPT },
        create: { key: 'multi_agent_post_fixer_prompt', value: IMPROVED_FIXER_PROMPT }
    });

    console.log('✅ Fixer prompt updated successfully!');
    await prisma.$disconnect();
    process.exit(0);
}

updateFixerPrompt().catch(console.error);
