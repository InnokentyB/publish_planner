"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = require("dotenv");
const multi_agent_service_1 = __importDefault(require("./services/multi_agent.service"));
(0, dotenv_1.config)();
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function setGeminiKey() {
    const KEY = 'AIza-PLACEHOLDER';
    console.log('Setting key for Post Critic (Gemini)...');
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY },
        update: { value: KEY },
        create: { key: multi_agent_service_1.default.KEY_POST_CRITIC_KEY, value: KEY }
    });
    // Set model to gemini-1.5-flash
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_CRITIC_MODEL },
        update: { value: 'gemini-2.0-flash' },
        create: { key: multi_agent_service_1.default.KEY_POST_CRITIC_MODEL, value: 'gemini-2.0-flash' }
    });
    console.log('Gemini key and model set successfully.');
}
setGeminiKey()
    .catch(console.error)
    .finally(async () => {
    await prisma.$disconnect();
});
