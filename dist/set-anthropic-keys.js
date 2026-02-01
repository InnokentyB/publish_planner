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
async function setKeys() {
    const KEY = 'sk-ant-PLACEHOLDER';
    console.log('Setting keys for Post Creator and Post Fixer...');
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_CREATOR_KEY },
        update: { value: KEY },
        create: { key: multi_agent_service_1.default.KEY_POST_CREATOR_KEY, value: KEY }
    });
    // Create prompt for Creator model if not exists, default to claude-3-5-sonnet-20241022
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_CREATOR_MODEL },
        update: { value: 'claude-3-haiku-20240307' },
        create: { key: multi_agent_service_1.default.KEY_POST_CREATOR_MODEL, value: 'claude-3-haiku-20240307' }
    });
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_FIXER_KEY },
        update: { value: KEY },
        create: { key: multi_agent_service_1.default.KEY_POST_FIXER_KEY, value: KEY }
    });
    // Create prompt for Fixer model if not exists
    await prisma.promptSettings.upsert({
        where: { key: multi_agent_service_1.default.KEY_POST_FIXER_MODEL },
        update: { value: 'claude-3-haiku-20240307' },
        create: { key: multi_agent_service_1.default.KEY_POST_FIXER_MODEL, value: 'claude-3-haiku-20240307' }
    });
    console.log('Keys and models set successfully.');
}
setKeys()
    .catch(console.error)
    .finally(async () => {
    await prisma.$disconnect();
});
