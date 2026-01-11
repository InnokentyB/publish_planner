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

    const channel = await prisma.channel.upsert({
        where: { id: 1 },
        update: {
            telegram_channel_id: BigInt(channelIdEnv || 0)
        },
        create: {
            id: 1,
            name: 'Main Content Channel',
            telegram_channel_id: BigInt(channelIdEnv || 0)
        }
    });
    console.log('✅ Channel record updated with ID:', channel.telegram_channel_id.toString());
}

// Handle BigInt serialization
// @ts-ignore
BigInt.prototype.toJSON = function () { return this.toString() }

main().catch(console.error).finally(() => prisma.$disconnect());
