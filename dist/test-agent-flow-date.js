"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const agent_service_1 = __importDefault(require("./services/agent.service"));
const dotenv_1 = require("dotenv");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
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
    const response1 = await agent_service_1.default.processMessage(request);
    console.log(`Agent: ${response1}`);
    // If agent asks for confirmation, say 'yes'
    if (response1.toLowerCase().includes('подтверди') || response1.includes('?')) {
        console.log(`\nUser: да`);
        await agent_service_1.default.processMessage("да");
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
        }
        else {
            console.error('FAILURE: Date mismatch. Created:', week.week_start);
        }
    }
    else {
        console.error('\nFAILURE: Week was not created.');
    }
    process.exit(0);
}
main().catch(console.error);
