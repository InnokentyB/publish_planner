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
    const weeks = await prisma.week.findMany({ include: { posts: true } });
    console.log(JSON.stringify(weeks, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
