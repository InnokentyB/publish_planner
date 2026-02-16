
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
    const weeks = await prisma.week.findMany({
        where: { project_id: 1 },
        orderBy: { created_at: 'desc' },
        include: { _count: { select: { posts: true } } }
    });
    console.log('--- Weeks for Project 1 ---');
    weeks.forEach(w => {
        console.log(`ID: ${w.id} | Start: ${w.week_start.toISOString()} | End: ${w.week_end.toISOString()} | Created: ${w.created_at.toISOString()} | Posts: ${w._count.posts}`);
    });

}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
