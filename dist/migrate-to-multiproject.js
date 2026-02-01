"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const bcrypt = __importStar(require("bcrypt"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
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
        const oldChannels = await prisma.$queryRaw `
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
            const weeksUpdated = await prisma.$executeRaw `
                UPDATE "weeks" 
                SET "project_id" = ${project.id}
                WHERE "channel_id" = ${oldChannel.id} AND "project_id" IS NULL
            `;
            console.log(`   Updated ${weeksUpdated} weeks`);
            // Update posts to reference new social channel
            const postsUpdated = await prisma.$executeRaw `
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
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
    finally {
        await prisma.$disconnect();
        await pool.end();
    }
}
migrate()
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
