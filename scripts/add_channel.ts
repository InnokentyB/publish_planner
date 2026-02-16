import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import readline from 'readline';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

async function main() {
    try {
        // 1. List Projects
        const projects = await prisma.project.findMany();
        console.log('\n--- Available Projects ---');
        projects.forEach(p => console.log(`${p.id}: ${p.name} (${p.slug})`));

        // 2. Select Project
        const projectIdStr = await question('\nEnter Project ID to add channel to: ');
        const projectId = parseInt(projectIdStr);

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            console.error('Project not found!');
            process.exit(1);
        }

        // 3. Get Channel Details
        const channelName = await question('Enter Channel Name (e.g. My Tech Channel): ');
        const channelId = await question('Enter Telegram Channel ID (start with -100 for private/supergroups): ');
        const channelUsername = await question('Enter Channel Username (optional, without @, press enter to skip): ');

        // 4. Create Channel
        const config: any = {
            telegram_channel_id: channelId
        };
        if (channelUsername) {
            config.channel_username = channelUsername;
        }

        const channel = await prisma.socialChannel.create({
            data: {
                project_id: projectId,
                type: 'telegram',
                name: channelName,
                config: config
            }
        });

        console.log('\n✅ Channel added successfully!');
        console.log(`ID: ${channel.id}`);
        console.log(`Name: ${channel.name}`);
        console.log(`Config: ${JSON.stringify(channel.config)}`);

        console.log('\nNOTE: New posts created for this project will now use this channel by default.');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
        rl.close();
        process.exit(0);
    }
}

main();
