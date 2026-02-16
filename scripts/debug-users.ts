import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

async function main() {
    console.log('--- Users ---');
    const users = await prisma.user.findMany({ include: { memberships: { include: { project: true } } } });

    for (const u of users) {
        console.log(`User: ${u.email} (ID: ${u.id})`);
        const token = jwt.sign({ id: u.id, email: u.email, name: u.name }, JWT_SECRET, { expiresIn: '1d' });
        console.log(`Generated Token: ${token}`);

        if (u.memberships.length === 0) {
            console.log(' - No projects');
        } else {
            for (const m of u.memberships) {
                console.log(` - Project: ${m.project.name} (ID: ${m.project.id}, Role: ${m.role})`);
            }
        }
    }

    console.log('\n--- Weeks ---');
    const weeks = await prisma.week.findMany();
    for (const w of weeks) {
        console.log(`Week ${w.id}: ${w.theme} (Project: ${w.project_id}) - Status: ${w.status}`);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
