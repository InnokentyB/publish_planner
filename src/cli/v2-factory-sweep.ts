import { PrismaClient } from '@prisma/client';
import generatorService from '../services/generator.service';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const retryFailed = process.argv.includes('--retry-failed');
    const targetStatus = retryFailed ? 'failed' : 'planned';

    console.log(`[Factory Sweep] Starting generation sweep for APPROVED v2 plans (target status: ${targetStatus})...`);

    try {
        const itemsToProcess = await prisma.contentItem.findMany({
            where: {
                status: targetStatus,
                week_package: {
                    approval_status: 'approved'
                }
            },
            take: 5 // Process in batches to avoid rate limits
        });

        if (itemsToProcess.length === 0) {
            console.log(`[Factory Sweep] No approved '${targetStatus}' items found. Exiting.`);
            return;
        }

        console.log(`[Factory Sweep] Found ${itemsToProcess.length} items to generate.`);

        for (const item of itemsToProcess) {
            console.log(` -> Generating text for ContentItem ${item.id} [${item.type}]...`);
            try {
                await generatorService.generateContentItemText(item.id);
                console.log(`    ✅ Success: Item ${item.id} moved to 'drafted'.`);
            } catch (err: any) {
                const errMsg = err?.message || err?.toString() || '';

                if (errMsg.toLowerCase().includes('quota') || errMsg.includes('429')) {
                    console.error(`    ❌ [API Quota Exceeded] on item ${item.id}. Please check your OpenAI billing.`);
                } else {
                    console.error(`    ❌ Error on item ${item.id}:`, errMsg);
                }

                // Mark failed
                await prisma.contentItem.update({
                    where: { id: item.id },
                    data: { status: 'failed' }
                });
            }
        }

        console.log(`[Factory Sweep] Batch complete.`);
    } catch (err) {
        console.error("Sweep error:", err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
