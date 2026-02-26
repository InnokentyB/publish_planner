"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const multi_agent_service_1 = __importDefault(require("./services/multi_agent.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function testGemini() {
    console.log('--- Starting Gemini Verification ---');
    console.log('Running generation with keys:');
    console.log('Creator & Fixer: Anthropic (claude-3-haiku-20240307)');
    console.log('Critic: Gemini (gemini-1.5-flash)');
    // We assume the keys are already set in DB by previous scripts
    try {
        const result = await multi_agent_service_1.default.runPostGeneration(1, 'Web Development', 'Why TypeScript is Essential in 2026', -1);
        console.log('Generation finished successfully!');
        console.log('Final Score:', result.score);
        console.log('Iterations:', result.iterations);
        // Inspect history to see if critique looks valid
        if (result.history.length > 0) {
            console.log('First Critique:', JSON.stringify(result.history[0].critique));
            if (result.history[0].critique && result.history[0].critique.length > 10) {
                console.log('✅ SUCCESS: Gemini Critic returned a critique.');
            }
            else {
                console.log('❌ FAIL: Empty or invalid critique from Gemini.');
            }
        }
    }
    catch (e) {
        console.log('❌ FAILED with error:');
        console.error(e);
    }
}
testGemini()
    .catch(console.error)
    .finally(async () => {
    await prisma.$disconnect();
});
