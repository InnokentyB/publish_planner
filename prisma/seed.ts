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
    const channelIdEnv = process.env.TELEGRAM_CHANNEL_ID;
    if (!channelIdEnv) {
        console.warn('⚠️  WARNING: TELEGRAM_CHANNEL_ID is not set in .env. Publishing will not work until you set it and run seed again.');
    }

    let channelIdStr = channelIdEnv || '0';

    // Fix common copy-paste error where ID becomes -100100...
    if (channelIdStr.startsWith('-100100') && channelIdStr.length > 15) {
        console.warn(`⚠️  Detected potential double-prefix in Channel ID: ${channelIdStr}. Auto-correcting...`);
        channelIdStr = channelIdStr.replace('-100100', '-100');
        console.log(`✅ Corrected ID to: ${channelIdStr}`);
    }

    const channel = await prisma.channel.upsert({
        where: { id: 1 },
        update: {
            telegram_channel_id: BigInt(channelIdStr)
        },
        create: {
            id: 1,
            name: 'Main Content Channel',
            telegram_channel_id: BigInt(channelIdStr)
        }
    });
    console.log('✅ Channel record updated with ID:', channel.telegram_channel_id.toString());
}

// Handle BigInt serialization
// @ts-ignore
BigInt.prototype.toJSON = function () { return this.toString() }

main().catch(console.error).finally(() => prisma.$disconnect());
