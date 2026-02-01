import agentService from './services/agent.service';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Testing Agent planning flow...');

    // 1. Simulate "Reset all" - clear history in reality we just start fresh agentService in this script context
    // In actual app, history is per-instance, but here we just instantiate and use.
    // Wait, AgentService is a singleton exporting 'new'.

    // Let's first clear DB to be sure
    await prisma.post.deleteMany({});
    await prisma.week.deleteMany({});
    console.log('DB Cleared.');

    // 2. User sends theme
    const theme = "Тестирование Агентов";
    console.log(`\nUser: ${theme}`);
    const response1 = await agentService.processMessage(theme);
    console.log(`Agent: ${response1}`);

    // 3. User says "Yes"
    console.log(`\nUser: да`);
    const response2 = await agentService.processMessage("да");
    console.log(`Agent: ${response2}`);

    // 4. Verify DB
    const week = await prisma.week.findFirst({
        where: { theme: theme },
        include: { posts: true }
    });

    if (week && week.posts.length > 0) {
        console.log(`\nSUCCESS: Week created with ${week.posts.length} posts.`);
    } else {
        console.error('\nFAILURE: Week was not created.');
    }

    process.exit(0);
}

main().catch(console.error);
