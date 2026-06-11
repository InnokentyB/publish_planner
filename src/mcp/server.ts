import '../bootstrap-env';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPlannerMcpServer, shutdownMcpResources } from './shared';

const server = createPlannerMcpServer();

async function shutdown(code = 0) {
    try {
        await server.close();
    } catch (_error) {
        // Ignore shutdown errors.
    }

    await shutdownMcpResources();
    process.exit(code);
}

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

process.on('SIGINT', () => {
    shutdown(0).catch((error) => {
        console.error('[MCP] SIGINT shutdown failed:', error);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdown(0).catch((error) => {
        console.error('[MCP] SIGTERM shutdown failed:', error);
        process.exit(1);
    });
});

main().catch((error) => {
    console.error('[MCP] Server failed to start:', error);
    shutdown(1).catch(() => process.exit(1));
});
