import plannerService from './services/planner.service';
import generatorService from './services/generator.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
config();

async function main() {
    console.log('Testing createWeek...');
    const now = new Date();
    // Use fixed dates to avoid logic issues
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    try {
        const week = await plannerService.createWeek(1, "Debug Theme", start, end);
        console.log('Week created:', week);
    } catch (e) {
        console.error('Create Week Failed:', e);
    }
}

main();
