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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fae_service_1 = __importDefault(require("../services/fae.service"));
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
const askQuestion = (query) => {
    return new Promise(resolve => rl.question(query, resolve));
};
async function main() {
    console.log(`\n======================================================`);
    console.log(`          FEEDBACK & ADAPTATION ENGINE (FAE)`);
    console.log(`======================================================\n`);
    try {
        const projectIdStr = await askQuestion("Project ID to collect feedback for: ");
        const projectId = parseInt(projectIdStr, 10);
        if (!projectId) {
            console.error("Invalid Project ID.");
            process.exit(1);
        }
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project)
            throw new Error("Project not found");
        console.log(`\nRate the content for the past week (1-10):`);
        const depthStr = await askQuestion("Depth (Глубина): ");
        const styleStr = await askQuestion("Style (Стиль): ");
        const accuracyStr = await askQuestion("Accuracy (Точность): ");
        const usefulnessStr = await askQuestion("Usefulness (Польза): ");
        const notes = await askQuestion("\nFree-text comments/complaints for the AI: ");
        const ownerScores = {
            depth: parseInt(depthStr, 10) || 5,
            style: parseInt(styleStr, 10) || 5,
            accuracy: parseInt(accuracyStr, 10) || 5,
            usefulness: parseInt(usefulnessStr, 10) || 5
        };
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - 7);
        console.log(`\n[FAE] Analyzing feedback and generating strategy shifts... please wait.\n`);
        const result = await fae_service_1.default.processFeedback(projectId, 'week', start, today, ownerScores, notes);
        console.log(`\n======================================================`);
        console.log(`FAE RECOMMENDATIONS SAVED!`);
        console.log(`--- The AI recommends: ---`);
        console.log(result.recommendations);
        console.log(`\n--- Changes applied to future strategy: ---`);
        console.log(result.applied_changes);
        console.log(`======================================================\n`);
    }
    catch (e) {
        console.error(e);
    }
    finally {
        rl.close();
        await prisma.$disconnect();
    }
}
main();
