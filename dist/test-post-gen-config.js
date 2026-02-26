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
async function testConfig() {
    console.log('--- Starting Config Verification ---');
    // 1. Set a "BAD" API Key for the Critic to ensure it falls (proving it uses the custom key)
    const badKey = 'sk-proj-INVALID-KEY-FOR-TESTING-12345';
    console.log(`Setting Post Critic Key to: ${badKey}`);
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY },
        update: { value: badKey },
        create: { key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY, value: badKey }
    });
    console.log('Running generation...');
    try {
        const result = await multi_agent_service_1.default.runPostGeneration(1, 'Test Theme', 'Test Topic for Config Check', -1);
        console.log('Generation finished (Unexpected success given bad key)');
        console.log('Score:', result.score);
    }
    catch (e) {
        console.log('Caught expected error during generation:');
        // We expect an error from OpenAI about invalid key
        if (e?.message?.includes('Incorrect API key') || e?.status === 401) {
            console.log('✅ SUCCESS: Caught "Incorrect API key" error. This confirms the custom key was used.');
        }
        else {
            console.log('❓ Caught different error:', e.message);
            console.log(e);
        }
    }
    finally {
        // Cleanup: Remove the bad key
        console.log('Cleaning up...');
        await prisma.promptSettings.delete({
            where: { key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY }
        });
        console.log('Cleanup done.');
    }
}
testConfig()
    .catch(console.error)
    .finally(async () => {
    await prisma.$disconnect();
});
