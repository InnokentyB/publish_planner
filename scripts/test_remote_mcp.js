#!/usr/bin/env node

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const expectedTools = [
  'ba_list_projects',
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
  'ba_import_publication_plan_json',
  'ba_import_publication_plan_file',
  'ba_list_publication_plan_assets',
  'ba_read_publication_plan_asset',
  'ba_read_publication_plan_ref',
  'ba_list_project_channels',
  'ba_list_publication_tasks',
  'ba_get_publication_task',
  'ba_get_publication_task_resources',
  'ba_prepare_publication_task',
  'ba_confirm_publication',
  'ba_publish_direct',
];

function logStep(label, details) {
  if (details) {
    console.log(`[Remote MCP Smoke] ${label}: ${details}`);
    return;
  }
  console.log(`[Remote MCP Smoke] ${label}`);
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
    url: process.env.MCP_REMOTE_URL || null,
    authToken: process.env.MCP_AUTH_TOKEN || null,
    skipHealth: false,
    skipDb: false,
    userId: null,
    projectId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--url') {
      result.url = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === '--auth-token') {
      result.authToken = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === '--skip-health') {
      result.skipHealth = true;
      continue;
    }

    if (arg === '--skip-db') {
      result.skipDb = true;
      continue;
    }

    if (arg === '--user-id') {
      const raw = argv[index + 1];
      result.userId = raw ? Number(raw) : null;
      index += 1;
      continue;
    }

    if (arg === '--project-id') {
      const raw = argv[index + 1];
      result.projectId = raw ? Number(raw) : null;
      index += 1;
    }
  }

  return result;
}

function normalizeUrl(url) {
  if (!url) {
    throw new Error('Remote MCP URL is required. Pass --url or set MCP_REMOTE_URL.');
  }

  const normalized = url.replace(/\/+$/, '');
  return normalized.endsWith('/mcp') ? normalized : `${normalized}/mcp`;
}

async function healthCheck(mcpUrl) {
  const healthUrl = mcpUrl.replace(/\/mcp$/, '/health');
  logStep('Calling remote MCP /health', healthUrl);

  const response = await fetch(healthUrl);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`/health returned ${response.status}: ${text}`);
  }

  logStep('Remote MCP /health succeeded', text || 'OK');
}

async function connectClient(mcpUrl, authToken) {
  const headers = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers,
    },
  });

  const client = new Client({ name: 'ba-remote-mcp-smoke-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function callToolOrThrow(client, name, args, exitCode) {
  const result = await client.callTool({
    name,
    arguments: args,
  });

  if (result.isError) {
    const errorText = extractText(result);
    const error = new Error(`${name} returned an error${errorText ? `: ${errorText}` : ''}`);
    error.exitCode = exitCode;
    throw error;
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mcpUrl = normalizeUrl(args.url);

  if (!args.skipHealth) {
    try {
      await healthCheck(mcpUrl);
    } catch (error) {
      console.error('[Remote MCP Smoke] FAILED:', error && error.message ? error.message : error);
      process.exit(5);
    }
  } else {
    logStep('Skipping remote MCP /health', '--skip-health set');
  }

  let client;
  let transport;

  try {
    logStep('Connecting to remote MCP', mcpUrl);
    ({ client, transport } = await connectClient(mcpUrl, args.authToken));
    logStep('Connected');

    const listed = await client.listTools();
    const toolNames = (listed.tools || []).map((tool) => tool.name);
    const missing = expectedTools.filter((name) => !toolNames.includes(name));

    if (missing.length > 0) {
      throw new Error(`Missing expected tools: ${missing.join(', ')}`);
    }

    logStep('Tools available', toolNames.join(', '));

    if (args.skipDb) {
      logStep('Skipping DB-backed remote tool call', '--skip-db set');
      return;
    }

    logStep('Calling ba_list_projects');
    const projectsResult = await callToolOrThrow(client, 'ba_list_projects', {}, 6);
    const projects = Array.isArray(projectsResult.structuredContent && projectsResult.structuredContent.projects)
      ? projectsResult.structuredContent.projects
      : [];
    logStep('ba_list_projects succeeded', `${projects.length} project(s) visible`);

    if (args.userId && args.projectId) {
      logStep('Calling ba_parser_health', `project=${args.projectId}, user=${args.userId}`);
      await callToolOrThrow(client, 'ba_parser_health', {
        userId: args.userId,
        projectId: args.projectId,
      }, 7);
      logStep('ba_parser_health succeeded');
    }
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }

    if (transport && typeof transport.terminateSession === 'function') {
      await transport.terminateSession().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error('[Remote MCP Smoke] FAILED:', error && error.message ? error.message : error);
  process.exit(error && Number.isInteger(error.exitCode) ? error.exitCode : 1);
});
