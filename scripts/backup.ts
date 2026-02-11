
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(__dirname, '../backup');

async function backup() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR);
    }

    console.log('Starting backup...');

    // Helper to backup a model
    const backupModel = async (modelName: string, modelDelegate: any) => {
        console.log(`Backing up ${modelName}...`);
        try {
            const data = await modelDelegate.findMany();
            fs.writeFileSync(
                path.join(BACKUP_DIR, `${modelName}.json`),
                JSON.stringify(data, null, 2)
            );
            console.log(`Backed up ${data.length} records for ${modelName}`);
        } catch (error) {
            console.error(`Failed to backup ${modelName}:`, error);
        }
    };

    await backupModel('User', prisma.user);
    await backupModel('Project', prisma.project);
    await backupModel('ProjectMember', prisma.projectMember);
    await backupModel('ProjectSettings', prisma.projectSettings);
    await backupModel('SocialChannel', prisma.socialChannel);
    await backupModel('Week', prisma.week);
    await backupModel('Post', prisma.post);
    await backupModel('PromptPreset', prisma.promptPreset);
    await backupModel('Comment', prisma.comment);
    await backupModel('ProviderKey', prisma.providerKey);
    await backupModel('AgentRun', prisma.agentRun);
    await backupModel('AgentIteration', prisma.agentIteration);
    await backupModel('Event', prisma.event);
    await backupModel('PromptSettings', prisma.promptSettings); // Legacy

    console.log('Backup complete!');
}

backup()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
