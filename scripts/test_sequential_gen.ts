
import { PrismaClient } from '@prisma/client';
import sequentialWriterService from '../src/services/sequential_writer.service';
import prisma from '../src/db';

async function main() {
    console.log("Testing Sequential Generation...");

    // 1. Find or Create a Test Week
    const project = await prisma.project.findFirst();
    if (!project) {
        console.error("No project found");
        return;
    }

    let week = await prisma.week.findFirst({ where: { project_id: project.id } });
    if (!week) {
        console.log("Creating test week...");
        week = await prisma.week.create({
            data: {
                project_id: project.id,
                week_start: new Date(),
                week_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                theme: "Test Theme: AI in 2026",
                status: "draft"
            }
        });
    }

    console.log(`Using week ${week.id} (${week.theme})`);

    // 2. create a dummy post if none
    const existingPost = await prisma.post.findFirst({ where: { week_id: week.id } });
    if (!existingPost) {
        await prisma.post.create({
            data: {
                project_id: project.id,
                week_id: week.id,
                slot_date: new Date(),
                slot_index: 0,
                publish_at: new Date(),
                topic_index: 1,
                topic: "The State of LLMs",
                status: "draft"
            }
        });
    }

    // 3. Run Generator (this will Mock calls if we don't have credits, or run real ones)
    // Note: This consumes tokens if real keys are used!
    // We strictly want to test the FLOW, not necessarily the output quality right now.

    // For safety, let's just check if we can initialize the memory and *attempt* to run.
    // If we want to fully test, we need to mock MultiAgentService or accept the cost.
    // I will let it run but maybe catch the error if OpenAI missing.

    try {
        await sequentialWriterService.generateWeekPosts(project.id, week.id);
        console.log("Generation cycle completed.");
    } catch (e) {
        console.error("Generation cycle error:", e);
    }

    // 4. Verify Memory
    const memory = await prisma.weekMemory.findUnique({ where: { week_id: week.id } });
    console.log("Week Memory:", memory);
}

main();
