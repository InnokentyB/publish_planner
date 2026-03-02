"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const v2_orchestrator_service_1 = __importDefault(require("../services/v2_orchestrator.service"));
const dotenv_1 = require("dotenv");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const projectId = parseInt(process.argv[2], 10);
    const themeHint = process.argv[3] || '';
    if (!projectId) {
        console.error("Usage: npx ts-node src/cli/v2-plan-week.ts <projectId> [themeHint]");
        process.exit(1);
    }
    // Set weekStart to next Monday
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + daysUntilNextMonday);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);
    console.log(`[V2 CLI] Planning Week ${weekStart.toISOString().split('T')[0]} - ${weekEnd.toISOString().split('T')[0]}`);
    console.log(`[V2 CLI] Project ID: ${projectId}, Hint: "${themeHint}"`);
    console.log(`[SMO] Initializing...`);
    try {
        // Step 1: Smooth Strategy (SMO)
        const wp = await v2_orchestrator_service_1.default.planWeek(projectId, weekStart, weekEnd, themeHint);
        console.log(`[SMO] WeekPackage ${wp.id} created successfully.`);
        console.log(`Theme: ${wp.week_theme}`);
        console.log(`Thesis: ${wp.core_thesis}`);
        // Step 2: Architecture components (DA)
        // Hardcoded generic spec for MVP
        const channelsSpec = {
            "channels": [
                { "type": "tg_post", "count": 3 },
                { "type": "vk_post", "count": 1 },
                { "type": "habr_article", "count": 1 },
                { "type": "video_script", "count": 1 }
            ]
        };
        console.log(`[DA] Generating ContentItems layout...`);
        const items = await v2_orchestrator_service_1.default.architectDistribution(wp.id, channelsSpec);
        console.log(`[DA] Created ${items.length} draft ContentItems.`);
        // Step 3: Continuity Check (NCC)
        console.log(`[NCC] Running narrative flow checks...`);
        const validation = await v2_orchestrator_service_1.default.validateContinuity(wp.id);
        console.log(`[NCC] Validation result: ${validation.valid ? 'PASSED' : 'NEEDS ADJUSTMENT'}`);
        if (!validation.valid) {
            console.log(`[NCC] Critique: ${validation.critique}`);
        }
        console.log(`\n======================================`);
        console.log(`FINISHED PLANNING!`);
        console.log(`Please run 'npx ts-node src/cli/v2-approve-week.ts ${wp.id}' to review and approve.`);
        console.log(`======================================\n`);
    }
    catch (err) {
        console.error("Error during planning:", err);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
