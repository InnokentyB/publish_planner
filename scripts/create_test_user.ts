
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function createTestUser() {
    const email = 'test@example.com';
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const user = await prisma.user.upsert({
            where: { email },
            update: { password_hash: hashedPassword },
            create: {
                email,
                name: 'Test User',
                password_hash: hashedPassword
            }
        });
        console.log(`Created/Updated test user: ${email} / ${password}`);

        // Ensure access to a project
        const project = await prisma.project.findFirst();
        if (project) {
            await prisma.projectMember.upsert({
                where: { project_id_user_id: { project_id: project.id, user_id: user.id } },
                update: {},
                create: {
                    project_id: project.id,
                    user_id: user.id,
                    role: 'owner'
                }
            });
            console.log(`Added test user to project: ${project.name}`);
        } else {
            console.log('No projects found to assign.');
        }

    } catch (e) {
        console.error('Error creating test user:', e);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

createTestUser();
