
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const projectId = 1;
    const keys = [
        'multi_agent_topic_creator_prompt',
        'multi_agent_topic_critic_prompt',
        'multi_agent_topic_fixer_prompt'
    ];

    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: keys }
        }
    });

    console.log('--- Current Prompts in DB ---');
    settings.forEach(s => {
        console.log(`\n[${s.key}]:\n${s.value}`);
    });
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
