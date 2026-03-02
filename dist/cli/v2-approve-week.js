"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const readline = __importStar(require("readline"));
const dotenv_1 = require("dotenv");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
async function main() {
    const wpId = parseInt(process.argv[2], 10);
    if (!wpId) {
        console.error("Usage: npx ts-node src/cli/v2-approve-week.ts <weekPackageId>");
        process.exit(1);
    }
    try {
        const wp = await prisma.weekPackage.findUnique({
            where: { id: wpId },
            include: { content_items: { orderBy: { schedule_at: 'asc' } } }
        });
        if (!wp) {
            console.error(`WeekPackage ${wpId} not found.`);
            process.exit(1);
        }
        console.log(`\n======================================================`);
        console.log(`                 APPROVAL PACK v2`);
        console.log(`======================================================`);
        console.log(`Week: ${wp.week_start.toISOString().split('T')[0]} to ${wp.week_end.toISOString().split('T')[0]}`);
        console.log(`Status: ${wp.approval_status.toUpperCase()}`);
        console.log(`\n-- Strategy --`);
        console.log(`Theme: ${wp.week_theme}`);
        console.log(`Thesis: ${wp.core_thesis}`);
        console.log(`Focus: ${wp.audience_focus}`);
        console.log(`Intent: ${wp.intent_tag}`);
        console.log(`Monetization Tie: ${wp.monetization_tie}`);
        console.log(`\n-- Narrative Flow --`);
        const arcs = wp.narrative_arc;
        if (arcs)
            arcs.forEach((a, i) => console.log(`  Day ${i + 1}: ${a}`));
        console.log(`\n-- Content Items (${wp.content_items.length}) --`);
        wp.content_items.forEach(ci => {
            const dateStr = ci.schedule_at ? ci.schedule_at.toISOString().split('T')[0] : 'No Date';
            console.log(`[${dateStr}] [${ci.type.padEnd(12)}] (Layer: ${String(ci.layer).padEnd(8)}) ${ci.title}`);
            console.log(`      Brief: ${ci.brief?.substring(0, 80)}...`);
        });
        console.log(`\n-- Risks / NCC Warnings --`);
        const risks = wp.risks;
        if (risks && risks.length > 0) {
            risks.forEach(r => console.log(`! ${r}`));
        }
        else {
            console.log("No critical risks flagged.");
        }
        console.log(`======================================================\n`);
        if (wp.approval_status === 'approved') {
            console.log("This week is already approved.");
            process.exit(0);
        }
        rl.question("Do you approve this plan? (yes/no/edit): ", async (answer) => {
            if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
                await prisma.weekPackage.update({
                    where: { id: wp.id },
                    data: { approval_status: 'approved' }
                });
                console.log(`✅ WeekPackage ${wp.id} APPRoved.`);
                console.log(`Content Factory will now pick up these items during generation sweeps.`);
            }
            else if (answer.toLowerCase() === 'edit' || answer.toLowerCase() === 'e') {
                console.log("Edit mode is not fully interactive yet. Please manually edit the database or re-generate.");
            }
            else {
                await prisma.weekPackage.update({
                    where: { id: wp.id },
                    data: { approval_status: 'rejected' }
                });
                console.log(`❌ WeekPackage ${wp.id} REJECTED.`);
            }
            rl.close();
            await prisma.$disconnect();
        });
    }
    catch (e) {
        console.error(e);
        rl.close();
        await prisma.$disconnect();
    }
}
main();
