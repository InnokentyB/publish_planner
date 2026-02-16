import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import * as readline from 'readline';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
};

async function main() {
    try {
        console.log('--- Create New Project ---');

        const email = await question('Enter owner email: ');
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            console.error('User not found!');
            process.exit(1);
        }

        const name = await question('Enter project name: ');
        const slugInput = await question('Enter project slug (optional): ');
        const slug = slugInput || name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

        console.log(`Creating project "${name}" for ${user.email}...`);

        const project = await prisma.project.create({
            data: {
                name,
                slug,
                description: 'Created via CLI script',
                members: {
                    create: {
                        user_id: user.id,
                        role: 'owner'
                    }
                },
                settings: {
                    createMany: {
                        data: [
                            { key: 'post_creator_prompt', value: 'You are a helpful assistant.' },
                            { key: 'post_creator_model', value: 'gpt-4' }
                        ]
                    }
                }
            }
        });

        console.log(`✅ Project created successfully!`);
        console.log(`ID: ${project.id}`);
        console.log(`Name: ${project.name}`);
        console.log(`Slug: ${project.slug}`);

    } catch (e) {
        console.error('Error creating project:', e);
    } finally {
        rl.close();
        await prisma.$disconnect();
    }
}

// Handle BigInt serialization
// @ts-ignore
BigInt.prototype.toJSON = function () { return this.toString() }

main();
