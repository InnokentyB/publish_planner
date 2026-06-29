#!/usr/bin/env node

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const expectedParserTools = [
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
];

function logStep(label, details) {
  if (details) {
    console.log(`[Parser Smoke] ${label}: ${details}`);
    return;
  }
  console.log(`[Parser Smoke] ${label}`);
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
    skipDirect: false,
    skipMcp: false,
    skipSearch: false,
    userId: null,
    projectId: null,
    query: null,
    subreddit: null,
    subreddits: [],
    limit: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--skip-direct') {
      result.skipDirect = true;
      continue;
    }

    if (arg === '--skip-mcp') {
      result.skipMcp = true;
      continue;
    }

    if (arg === '--skip-search') {
      result.skipSearch = true;
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
      continue;
    }

    if (arg === '--query') {
      result.query = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === '--subreddit') {
      result.subreddit = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === '--subreddits') {
      const raw = argv[index + 1] || '';
      result.subreddits = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (arg === '--limit') {
      const raw = argv[index + 1];
      result.limit = raw ? Number(raw) : 10;
      index += 1;
    }
  }

  return result;
}

async function directHealthCheck(baseUrl, serviceToken) {
  if (!baseUrl) {
    throw new Error('PARSER_API_BASE_URL is required for direct parser smoke');
  }

  const target = `${baseUrl.replace(/\/+$/, '')}/health`;
  const headers = {};
  if (serviceToken) {
    headers.authorization = `Bearer ${serviceToken}`;
  }

  logStep('Calling parser /health', target);
  const response = await fetch(target, { headers });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Parser /health returned ${response.status}: ${bodyText}`);
  }

  logStep('Parser /health succeeded', bodyText || 'OK');
}

async function connectMcpClient() {
  const serverPath = path.join(process.cwd(), 'dist', 'mcp', 'server.js');
  logStep('Starting stdio MCP client', serverPath);

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

  const client = new Client({ name: 'ba-parser-chain-smoke-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function verifyMcpTooling(client) {
  const listed = await client.listTools();
  const toolNames = (listed.tools || []).map((tool) => tool.name);
  const missing = expectedParserTools.filter((name) => !toolNames.includes(name));

  if (missing.length > 0) {
    throw new Error(`Missing parser MCP tools: ${missing.join(', ')}`);
  }

  logStep('Parser MCP tools available', expectedParserTools.join(', '));
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
  const parserBaseUrl = process.env.PARSER_API_BASE_URL;
  const parserServiceToken = process.env.PARSER_SERVICE_TOKEN;

  if (!args.skipDirect) {
    try {
      await directHealthCheck(parserBaseUrl, parserServiceToken);
    } catch (error) {
      console.error('[Parser Smoke] FAILED:', error && error.message ? error.message : error);
      process.exit(5);
    }
  } else {
    logStep('Skipping direct parser health', '--skip-direct set');
  }

  if (args.skipMcp) {
    logStep('Skipping MCP-backed parser checks', '--skip-mcp set');
    return;
  }

  if (!args.userId || !Number.isInteger(args.userId) || args.userId <= 0) {
    throw new Error('--user-id is required for MCP-backed parser smoke');
  }

  if (!args.projectId || !Number.isInteger(args.projectId) || args.projectId <= 0) {
    throw new Error('--project-id is required for MCP-backed parser smoke');
  }

  const client = await connectMcpClient();

  try {
    await verifyMcpTooling(client);

    logStep('Calling ba_parser_health', `project=${args.projectId}, user=${args.userId}`);
    await callToolOrThrow(
      client,
      'ba_parser_health',
      { userId: args.userId, projectId: args.projectId },
      6
    );
    logStep('ba_parser_health succeeded');

    logStep('Calling ba_parser_list_templates', `project=${args.projectId}`);
    const templatesResult = await callToolOrThrow(
      client,
      'ba_parser_list_templates',
      { userId: args.userId, projectId: args.projectId },
      7
    );
    const templates = Array.isArray(templatesResult.structuredContent && templatesResult.structuredContent.templates)
      ? templatesResult.structuredContent.templates
      : [];
    logStep('ba_parser_list_templates succeeded', `${templates.length} template(s) returned`);

    if (args.skipSearch) {
      logStep('Skipping parser search job flow', '--skip-search set');
      return;
    }

    if (!args.query) {
      logStep('Skipping parser search job flow', 'no --query provided');
      return;
    }

    const searchArgs = {
      userId: args.userId,
      projectId: args.projectId,
      query: args.query,
      limit: args.limit,
    };

    if (args.subreddit) {
      searchArgs.subreddit = args.subreddit;
    }

    if (args.subreddits.length > 0) {
      searchArgs.subreddits = args.subreddits;
    }

    logStep('Calling ba_parser_create_search_job', `${args.query}`);
    const createResult = await callToolOrThrow(client, 'ba_parser_create_search_job', searchArgs, 8);
    const createdJob =
      createResult.structuredContent && (createResult.structuredContent.job || createResult.structuredContent.search_job);
    const jobId = createdJob && (createdJob.id || createdJob.job_id);

    if (!jobId) {
      throw new Error('ba_parser_create_search_job succeeded but no job id was returned');
    }

    logStep('ba_parser_create_search_job succeeded', `jobId=${jobId}`);

    logStep('Calling ba_parser_get_search_job', jobId);
    const jobResult = await callToolOrThrow(
      client,
      'ba_parser_get_search_job',
      {
        userId: args.userId,
        projectId: args.projectId,
        jobId,
      },
      9
    );

    const job =
      jobResult.structuredContent && (jobResult.structuredContent.job || jobResult.structuredContent.search_job);
    const status = job && (job.status || job.state);
    logStep('ba_parser_get_search_job succeeded', `status=${status || 'unknown'}`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[Parser Smoke] FAILED:', error && error.message ? error.message : error);
  process.exit(error && Number.isInteger(error.exitCode) ? error.exitCode : 1);
});
