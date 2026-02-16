
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // Find the latest week
    const week = await prisma.week.findFirst({
        orderBy: { created_at: 'desc' },
        include: { posts: true }
    });

    if (!week) {
        console.log('No weeks found.');
        return;
    }

    console.log(`Latest Week ID: ${week.id}`);
    console.log(`Created At: ${week.created_at.toISOString()}`);
    console.log(`Post Count: ${week.posts.length}`);
    console.log('--- Posts ---');
    week.posts.forEach(p => {
        console.log(`ID: ${p.id} | Slot: ${p.slot_index} | Created At: ${p.created_at.toISOString()} | Status: ${p.status}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
