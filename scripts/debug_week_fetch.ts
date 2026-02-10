
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
    const weekId = 2;
    console.log(`Fetching week ${weekId}...`);
    try {
        const week = await prisma.week.findUnique({
            where: { id: weekId },
            include: { posts: true }
        });

        if (!week) {
            console.log('Week not found');
            return;
        }
        console.log('Week fetched:', week.id, week.status, week.theme);

        if (week.status === 'topics_generated') {
            console.log('Status is topics_generated, looking for AgentRun...');
            const run = await prisma.agentRun.findFirst({
                where: { topic: `TOPICS: ${week.theme}` },
                orderBy: { created_at: 'desc' },
                include: { iterations: true }
            });
            console.log('AgentRun found:', run ? run.id : 'None');
        }

        console.log('Result would be:', { ...week, topics: null });

    } catch (e) {
        console.error('Error fetching week/run:', e);
    }
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
