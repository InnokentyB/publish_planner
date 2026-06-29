#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const expectedTools = [
  'ba_parser_health',
  'ba_parser_create_search_job',
  'ba_parser_get_search_job',
  'ba_parser_refresh_search_job',
  'ba_parser_list_posts',
  'ba_parser_get_insights',
  'ba_parser_get_summary',
  'ba_parser_list_templates',
  'ba_parser_import_templates',
  'ba_parser_run_template',
  'ba_import_publication_plan_file',
  'ba_import_publication_plan_json',
  'ba_list_projects',
  'ba_list_publication_plan_assets',
  'ba_list_project_channels',
  'ba_list_publication_tasks',
  'ba_get_publication_task',
  'ba_get_publication_task_resources',
  'ba_prepare_publication_task',
  'ba_confirm_publication',
  'ba_publish_direct',
  'ba_read_publication_plan_asset',
  'ba_read_publication_plan_ref',
];

function logStep(label, details) {
  if (details) {
    console.log(`[MCP Smoke] ${label}: ${details}`);
    return;
  }
  console.log(`[MCP Smoke] ${label}`);
}

function extractText(result) {
  if (!result || !Array.isArray(result.content)) {
    return '';
  }

  return result.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function parseArgs(argv) {
  const result = {
    skipDb: false,
    planPath: null,
    userId: null,
    importMode: 'json',
    readRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--skip-db') {
      result.skipDb = true;
      continue;
    }

    if (arg === '--plan-path') {
      result.planPath = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === '--user-id') {
      const raw = argv[index + 1];
      result.userId = raw ? Number(raw) : null;
      index += 1;
      continue;
    }

    if (arg === '--import-mode') {
      result.importMode = argv[index + 1] || 'json';
      index += 1;
      continue;
    }

    if (arg === '--read-ref') {
      result.readRef = argv[index + 1] || null;
      index += 1;
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serverPath = path.join(process.cwd(), 'dist', 'mcp', 'server.js');

  logStep('Starting stdio client', serverPath);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    cwd: process.cwd(),
    env: process.env,
    stderr: 'pipe',
  });

  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  }

  const client = new Client({ name: 'ba-post-planner-smoke-test', version: '1.0.0' });

  try {
    await client.connect(transport);
    logStep('Connected');

    const listed = await client.listTools();
    const toolNames = (listed.tools || []).map((tool) => tool.name);
    const missing = expectedTools.filter((name) => !toolNames.includes(name));

    if (missing.length > 0) {
      throw new Error(`Missing expected tools: ${missing.join(', ')}`);
    }

    logStep('Tools available', toolNames.join(', '));

    if (args.skipDb) {
      logStep('Skipping DB-backed tool call', '--skip-db set');
      return;
    }

    logStep('Calling ba_list_projects');
    const result = await client.callTool({
      name: 'ba_list_projects',
      arguments: {},
    });

    if (result.isError) {
      const errorText = extractText(result);
      logStep('DB-backed tool returned an error', errorText || 'Unknown error');
      process.exitCode = 2;
      return;
    }

    const projects = Array.isArray(result.structuredContent && result.structuredContent.projects)
      ? result.structuredContent.projects
      : [];
    logStep('ba_list_projects succeeded', `${projects.length} project(s) visible`);

    if (args.planPath) {
      if (!args.userId || !Number.isInteger(args.userId) || args.userId <= 0) {
        throw new Error('--user-id is required and must be a positive integer when --plan-path is provided');
      }

      const planJson = fs.readFileSync(args.planPath, 'utf8');
      const importToolName = args.importMode === 'file'
        ? 'ba_import_publication_plan_file'
        : 'ba_import_publication_plan_json';
      const importArgs = args.importMode === 'file'
        ? {
            userId: args.userId,
            planPath: args.planPath,
          }
        : {
            userId: args.userId,
            planJson,
          };

      logStep(`Calling ${importToolName}`, `${args.planPath} as user ${args.userId}`);

      const importResult = await client.callTool({
        name: importToolName,
        arguments: importArgs,
      });

      if (importResult.isError) {
        const errorText = extractText(importResult);
        logStep('Import tool returned an error', errorText || 'Unknown error');
        process.exitCode = 3;
        return;
      }

      const project = importResult.structuredContent && importResult.structuredContent.project;
      const imported = importResult.structuredContent && importResult.structuredContent.imported;
      logStep(
        `${importToolName} succeeded`,
        project && imported
          ? `project=${project.slug || project.name || project.id}, actions=${imported.actions}, accounts=${imported.accounts}`
          : 'Import completed'
      );

      if (args.readRef && project && project.id) {
        logStep('Calling ba_read_publication_plan_ref', `${args.readRef} on project ${project.id}`);
        const refResult = await client.callTool({
          name: 'ba_read_publication_plan_ref',
          arguments: {
            projectId: project.id,
            ref: args.readRef,
          },
        });

        if (refResult.isError) {
          const errorText = extractText(refResult);
          logStep('Ref read tool returned an error', errorText || 'Unknown error');
          process.exitCode = 4;
          return;
        }

        const resolvedType = refResult.structuredContent && refResult.structuredContent.resolved_type;
        logStep('ba_read_publication_plan_ref succeeded', `resolved_type=${resolvedType || 'unknown'}`);
      }
    }
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[MCP Smoke] FAILED:', error && error.message ? error.message : error);
  process.exit(1);
});
