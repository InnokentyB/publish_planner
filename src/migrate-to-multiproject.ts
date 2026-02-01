import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function migrate() {
    console.log('🚀 Starting multi-project migration...\n');

    try {
        // Step 1: Create default admin user
        console.log('📝 Creating default admin user...');
        const passwordHash = await bcrypt.hash('admin123', 10);

        const user = await prisma.user.upsert({
            where: { email: 'admin@example.com' },
            update: {},
            create: {
                email: 'admin@example.com',
                password_hash: passwordHash,
                name: 'Admin'
            }
        });
        console.log(`✅ User ensured: ${user.email} (ID: ${user.id})`);
        console.log(`   Default password: admin123\n`);

        // Step 2: Create default project
        console.log('📁 Creating default project...');
        const project = await prisma.project.upsert({
            where: { slug: 'analyst' },
            update: {},
            create: {
                name: 'Аналитик который думал',
                slug: 'analyst',
                description: 'Default project migrated from single-channel setup'
            }
        });
        console.log(`✅ Project ensured: ${project.name} (ID: ${project.id})\n`);

        // Step 3: Add admin as project owner
        console.log('👤 Adding admin as project owner...');
        await prisma.projectMember.upsert({
            where: {
                project_id_user_id: {
                    project_id: project.id,
                    user_id: user.id
                }
            },
            update: {
                role: 'owner'
            },
            create: {
                project_id: project.id,
                user_id: user.id,
                role: 'owner'
            }
        });
        console.log(`✅ Admin added as owner\n`);

        // Step 4: Migrate old channels to social_channels
        console.log('📱 Migrating channels to social channels...');
        const oldChannels = await prisma.$queryRaw<any[]>`
            SELECT * FROM "channels"
        `;

        for (const oldChannel of oldChannels) {
            const socialChannel = await prisma.socialChannel.upsert({
                where: { id: oldChannel.id }, // Assuming IDs map for initial migration
                update: {},
                create: {
                    id: oldChannel.id,
                    project_id: project.id,
                    type: 'telegram',
                    name: oldChannel.name,
                    config: {
                        telegram_channel_id: oldChannel.telegram_channel_id.toString(),
                        bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
                        chat_id: oldChannel.telegram_channel_id.toString()
                    },
                    is_active: true
                }
            });
            console.log(`✅ Migrated channel: ${socialChannel.name} (ID: ${socialChannel.id})`);

            // Update weeks to reference the project
            const weeksUpdated = await prisma.$executeRaw`
                UPDATE "weeks" 
                SET "project_id" = ${project.id}
                WHERE "channel_id" = ${oldChannel.id} AND "project_id" IS NULL
            `;
            console.log(`   Updated ${weeksUpdated} weeks`);

            // Update posts to reference new social channel
            const postsUpdated = await prisma.$executeRaw`
                UPDATE "posts" 
                SET "channel_id" = ${socialChannel.id}
                WHERE "channel_id" = ${oldChannel.id}
            `;
            console.log(`   Updated ${postsUpdated} posts`);
        }
        console.log();

        // Step 5: Migrate PromptSettings to ProjectSettings
        console.log('⚙️  Migrating prompt settings...');
        const promptSettings = await prisma.promptSettings.findMany();

        for (const setting of promptSettings) {
            await prisma.projectSettings.upsert({
                where: {
                    project_id_key: {
                        project_id: project.id,
                        key: setting.key
                    }
                },
                update: {
                    value: setting.value
                },
                create: {
                    project_id: project.id,
                    key: setting.key,
                    value: setting.value
                }
            });
            console.log(`✅ Migrated setting: ${setting.key}`);
        }
        console.log();

        // Step 6: Verify migration
        console.log('🔍 Verifying migration...');
        const weekCount = await prisma.week.count({ where: { project_id: project.id } });
        const postCount = await prisma.post.count();
        const settingCount = await prisma.projectSettings.count({ where: { project_id: project.id } });

        console.log(`✅ Weeks in project: ${weekCount}`);
        console.log(`✅ Total posts: ${postCount}`);
        console.log(`✅ Project settings: ${settingCount}\n`);

        console.log('🎉 Migration completed successfully!\n');
        console.log('📋 Summary:');
        console.log(`   - User: ${user.email}`);
        console.log(`   - Password: admin123 (CHANGE THIS!)`);
        console.log(`   - Project: ${project.name}`);
        console.log(`   - Channels: ${oldChannels.length}`);
        console.log();

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

migrate()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
