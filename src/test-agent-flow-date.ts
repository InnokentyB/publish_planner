
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
    console.log('Testing Agent planning flow with specific date...');

    // 1. Cleaup
    await prisma.post.deleteMany({});
    await prisma.week.deleteMany({});
    console.log('DB Cleared.');

    // 2. User asks for specific week
    const request = "Спланируй неделю с 26 января по 1 февраля на тему 'Agile'";
    console.log(`\nUser: ${request}`);

    // We expect the agent to either ask for confirmation OR just do it if the prompt is strong enough.
    // The previous prompt update said "IMMEDIATELY CALL... if confirming".
    // Here we are providing theme AND date in one go.
    // The agent might ask for confirmation or just execute.
    // Let's see.

    const response1 = await agentService.processMessage(request);
    console.log(`Agent: ${response1}`);

    // If agent asks for confirmation, say 'yes'
    if (response1.toLowerCase().includes('подтверди') || response1.includes('?')) {
        console.log(`\nUser: да`);
        await agentService.processMessage("да");
    }

    // 3. Verify DB
    // We expect a week starting 2026-01-26
    const week = await prisma.week.findFirst({
        where: { theme: 'Agile' },
        include: { posts: true }
    });

    if (week) {
        console.log(`\nSUCCESS: Week created for ${week.week_start} - ${week.week_end}`);
        if (week.week_start.toISOString().startsWith('2026-01-26')) {
            console.log('Date matches request!');
        } else {
            console.error('FAILURE: Date mismatch. Created:', week.week_start);
        }
    } else {
        console.error('\nFAILURE: Week was not created.');
    }

    process.exit(0);
}

main().catch(console.error);
