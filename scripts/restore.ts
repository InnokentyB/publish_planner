
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(__dirname, '../backup');

async function restore() {
    if (!fs.existsSync(BACKUP_DIR)) {
        console.error('Backup directory not found!');
        process.exit(1);
    }

    console.log('Starting restore...');

    const restoreModel = async (modelName: string, modelDelegate: any) => {
        const filePath = path.join(BACKUP_DIR, `${modelName}.json`);
        if (!fs.existsSync(filePath)) {
            console.log(`No backup found for ${modelName}, skipping.`);
            return;
        }

        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (data.length === 0) {
            console.log(`No records to restore for ${modelName}.`);
            return;
        }

        console.log(`Restoring ${data.length} records for ${modelName}...`);

        for (const record of data) {
            // Remove ID to let auto-increment handle it, OR keep it if we want to preserve IDs.
            // Preserving IDs is better for relational integrity.
            // However, we must ensure we don't hit conflicts if data already exists (which shouldn't happen after reset).

            try {
                // We use create because we want to enforce the specific ID.
                // If we used createMany, it might not be supported for all DBs or might skip validation.
                // Loop is slower but safer for this migration.
                await modelDelegate.create({
                    data: record
                });
            } catch (e: any) {
                if (e.code === 'P2002') {
                    console.warn(`Record with ID ${record.id} already exists for ${modelName}, skipping.`);
                } else {
                    console.error(`Failed to restore record for ${modelName}:`, e);
                    throw e;
                }
            }
        }

        // If we inserted explicitly with IDs, we might need to reset the sequence.
        // Postgres: SELECT setval(pg_get_serial_sequence('tablename', 'id'), coalesce(max(id)+1, 1), false) FROM tablename;
        // But Prisma doesn't easily expose table names.
        // We'll assume for now that since we truncated, inserting with IDs is fine.
        // But we DO need to fix the sequences afterwards.
        // Actually, let's just create them. If we insert with ID, Postgres usually DOES NOT update the sequence automatically.

        console.log(`Restored ${modelName}.`);
    };

    // Order matters for Foreign Keys!
    await restoreModel('User', prisma.user);
    await restoreModel('Project', prisma.project);
    await restoreModel('ProjectMember', prisma.projectMember);
    await restoreModel('ProjectSettings', prisma.projectSettings);
    await restoreModel('SocialChannel', prisma.socialChannel);
    await restoreModel('Week', prisma.week);
    await restoreModel('Post', prisma.post);
    await restoreModel('PromptPreset', prisma.promptPreset);
    await restoreModel('Comment', prisma.comment);
    await restoreModel('ProviderKey', prisma.providerKey);
    await restoreModel('AgentRun', prisma.agentRun);
    await restoreModel('AgentIteration', prisma.agentIteration);
    await restoreModel('Event', prisma.event);
    await restoreModel('PromptSettings', prisma.promptSettings);

    console.log('Restore complete! NOTE: You may need to manually reset auto-increment sequences if you insert new data.');

    // Attempt to reset sequences (Postgres specific)
    try {
        // Mapping model name to table name (based on schema @@map)
        const tableMap: Record<string, string> = {
            'User': 'users',
            'Project': 'projects',
            'ProjectMember': 'project_members',
            'ProjectSettings': 'project_settings',
            'SocialChannel': 'social_channels',
            'Week': 'weeks',
            'Post': 'posts',
            'PromptPreset': 'prompt_presets',
            'Comment': 'comments',
            'ProviderKey': 'provider_keys',
            'AgentRun': 'agent_runs',
            'AgentIteration': 'agent_iterations',
            'Event': 'events',
            'PromptSettings': 'prompt_settings'
        };

        for (const [model, table] of Object.entries(tableMap)) {
            // This requires raw query access
            try {
                await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), coalesce(max(id)+1, 1), false) FROM "${table}";`);
                console.log(`Reset sequence for ${table}`);
            } catch (e) {
                console.warn(`Could not reset sequence for ${table} (might not have id or permission):`, e);
            }
        }
    } catch (e) {
        console.warn('Failed to reset sequences:', e);
    }
}

restore()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
