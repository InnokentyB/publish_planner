
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const BATCH_SIZE = 100;

async function migrateTable(tableName: string, oldClient: Client, newClient: Client, conflictColumns: string[] = ['id']) {
    console.log(`Migrating table: ${tableName}...`);

    // Get columns
    const res = await oldClient.query(`SELECT * FROM ${tableName} LIMIT 1`);
    if (res.rowCount === 0) {
        console.log(`Table ${tableName} is empty. Skipping.`);
        return;
    }
    const columns = res.fields.map(f => f.name);
    const columnsList = columns.join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    // For ON CONFLICT, we update all columns except the conflict target
    const updateSet = columns
        .filter(c => !conflictColumns.includes(c))
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');

    const upsertQuery = `
        INSERT INTO ${tableName} (${columnsList})
        VALUES (${placeholders})
        ON CONFLICT (${conflictColumns.join(', ')}) 
        DO UPDATE SET ${updateSet};
    `;
    // If no columns to update (e.g. only ID), DO NOTHING
    const doNothingQuery = `
        INSERT INTO ${tableName} (${columnsList})
        VALUES (${placeholders})
        ON CONFLICT (${conflictColumns.join(', ')}) 
        DO NOTHING;
    `;

    const finalQuery = updateSet ? upsertQuery : doNothingQuery;

    // Fetch data in batches
    let offset = 0;
    while (true) {
        const { rows } = await oldClient.query(`SELECT * FROM ${tableName} ORDER BY id ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`);
        if (rows.length === 0) break;

        for (const row of rows) {
            const values = columns.map(c => row[c]);
            try {
                await newClient.query(finalQuery, values);
            } catch (e: any) {
                console.error(`Error inserting row into ${tableName} (ID: ${row.id}):`, e.message);
                throw e;
            }
        }

        offset += BATCH_SIZE;
        console.log(`Migrated ${offset} rows...`);
    }
    console.log(`Finished migrating ${tableName}.`);
}

async function runMigration() {
    if (!process.env.OLD_DATABASE_URL || !process.env.DATABASE_URL) {
        console.error("Missing OLD_DATABASE_URL or DATABASE_URL");
        return;
    }

    const oldClient = new Client({ connectionString: process.env.OLD_DATABASE_URL });
    const newClient = new Client({ connectionString: process.env.DATABASE_URL });

    try {
        await oldClient.connect();
        await newClient.connect();
        console.log("Connected to both databases.");

        // Order matters due to foreign keys!
        // Disable triggers to avoid recursive updates or event logs if desirable, 
        // but often better to just insert in order.

        // 1. Users
        await migrateTable('users', oldClient, newClient, ['email']); // email is unique

        // 2. Projects
        await migrateTable('projects', oldClient, newClient, ['slug']); // slug is unique

        // 3. Project Members (depends on user, project)
        await migrateTable('project_members', oldClient, newClient, ['project_id', 'user_id']);

        // 4. Project Settings
        await migrateTable('project_settings', oldClient, newClient, ['project_id', 'key']);

        // 5. Social Channels
        await migrateTable('social_channels', oldClient, newClient, ['id']); // Use ID as conflict target (PK) - auto-increment might drift but we copy usage

        // 6. Weeks (Content Planning)
        await migrateTable('weeks', oldClient, newClient, ['project_id', 'week_start', 'week_end']);

        // 7. Posts
        await migrateTable('posts', oldClient, newClient, ['id']);

        // 8. Other Tables
        await migrateTable('prompt_presets', oldClient, newClient, ['id']);
        await migrateTable('comments', oldClient, newClient, ['id']);
        await migrateTable('provider_keys', oldClient, newClient, ['id']);
        await migrateTable('telegram_accounts', oldClient, newClient, ['project_id', 'phone_number']);

        // 9. Agent Runs / Iterations (Logs)
        await migrateTable('agent_runs', oldClient, newClient, ['id']);
        await migrateTable('agent_iterations', oldClient, newClient, ['id']);

        // 10. Events
        await migrateTable('events', oldClient, newClient, ['id']);

        // Reset sequences to max id
        console.log("Resetting sequences...");
        const tables = ['users', 'projects', 'project_members', 'project_settings', 'social_channels', 'weeks', 'posts', 'prompt_presets', 'comments', 'provider_keys', 'telegram_accounts', 'agent_runs', 'agent_iterations', 'events'];

        for (const t of tables) {
            const res = await newClient.query(`SELECT MAX(id) as max_id FROM ${t}`);
            const maxId = res.rows[0].max_id || 0;
            await newClient.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), ${maxId + 1}, false)`);
        }

        console.log("Migration complete!");

    } catch (e: any) {
        console.error("Migration failed:", e);
    } finally {
        await oldClient.end();
        await newClient.end();
    }
}

runMigration();
