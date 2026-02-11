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
async function testAnthropic() {
    console.log('--- Starting Anthropic Verification ---');
    console.log('Running generation with Anthropic keys for Creator/Fixer...');
    // We assume the keys are already set in DB by the previous execution of set-anthropic-keys.ts
    // Creator: Anthropic
    // Critic: OpenAI (Default gpt-4o)
    // Fixer: Anthropic
    try {
        const result = await multi_agent_service_1.default.runPostGeneration(1, 'AI Trends 2026', 'Why coding agents are the future', -1);
        console.log('Generation finished successfully!');
        console.log('Final Score:', result.score);
        console.log('Iterations:', result.iterations);
        console.log('Final Text Length:', result.finalText.length);
        console.log('Preview:', result.finalText.substring(0, 200));
        if (result.finalText.length > 100) {
            console.log('✅ SUCCESS: Content generated via Anthropic (presumably) without crashing.');
        }
        else {
            console.log('❌ FAIL: Empty content generated.');
        }
    }
    catch (e) {
        console.log('❌ FAILED with error:');
        console.error(e);
    }
}
testAnthropic()
    .catch(console.error)
    .finally(async () => {
    await prisma.$disconnect();
});
