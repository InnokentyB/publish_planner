import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
  const runs = await prisma.agentRun.findMany({ orderBy: { id: 'desc' }, take: 2, include: { iterations: true }});
  console.log(JSON.stringify(runs, null, 2));
}
main().finally(() => prisma.$disconnect());
