import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not defined in .env');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const user = await prisma.user.upsert({
        where: { email: 'test@example.com' },
        update: {
            password_hash: '$2b$10$Ep7v7v7v7v7v7v7v7v7v7u' // 'password'
        },
        create: {
            email: 'test@example.com',
            password_hash: '$2b$10$Ep7v7v7v7v7v7v7v7v7v7u',
            name: 'Test User'
        }
    });

    const project = await prisma.project.upsert({
        where: { slug: 'test-project' },
        update: {},
        create: {
            name: 'Test Project',
            slug: 'test-project',
            description: 'Seeded for verification',
            members: {
                create: { user_id: user.id, role: 'owner' }
            }
        }
    });

    console.log(`✅ Seeded: User test@example.com / password, Project ID: ${project.id}`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
