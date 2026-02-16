import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // Create a specific test week for Project 1 (User 1 & 2 have access)
    // Find User 1
    const user = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
    if (!user) throw new Error('User admin not found');

    const project = await prisma.project.findFirst({ where: { id: 1 } });
    if (!project) throw new Error('Project 1 not found');

    // Create Week
    // Use a date far in future
    const start = new Date('2026-12-01');
    const end = new Date('2026-12-07');

    // Check if exists
    const existing = await prisma.week.findFirst({
        where: { project_id: project.id, week_start: start }
    });

    if (existing) {
        console.log(`Test week already exists: ID ${existing.id}`);
        // Create a dummy post to delete
        await prisma.post.create({
            data: {
                project_id: project.id,
                week_id: existing.id,
                slot_date: start,
                slot_index: 1,
                publish_at: start,
                topic_index: 1,
                topic: "Test Topic to Delete",
                status: "topics_generated"
            }
        });
        return existing.id;
    }

    const week = await prisma.week.create({
        data: {
            project_id: project.id,
            week_start: start,
            week_end: end,
            theme: "Test Regeneration Week",
            status: "planned"
        }
    });

    console.log(`Created test week: ID ${week.id}`);

    // Create a dummy post to delete
    await prisma.post.create({
        data: {
            project_id: project.id,
            week_id: week.id,
            slot_date: start,
            slot_index: 1,
            publish_at: start,
            topic_index: 1,
            topic: "Test Topic to Delete",
            status: "topics_generated"
        }
    });

    return week.id;
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
