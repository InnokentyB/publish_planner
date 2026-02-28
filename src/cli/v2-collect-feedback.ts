import { PrismaClient } from '@prisma/client';
import faeService from '../services/fae.service';
import * as readline from 'readline';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
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
        if (!project) throw new Error("Project not found");

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

        const result = await faeService.processFeedback(projectId, 'week', start, today, ownerScores, notes);

        console.log(`\n======================================================`);
        console.log(`FAE RECOMMENDATIONS SAVED!`);
        console.log(`--- The AI recommends: ---`);
        console.log(result.recommendations);
        console.log(`\n--- Changes applied to future strategy: ---`);
        console.log(result.applied_changes);
        console.log(`======================================================\n`);

    } catch (e) {
        console.error(e);
    } finally {
        rl.close();
        await prisma.$disconnect();
    }
}

main();
