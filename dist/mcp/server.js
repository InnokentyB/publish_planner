"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../bootstrap-env");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const shared_1 = require("./shared");
const server = (0, shared_1.createPlannerMcpServer)();
async function shutdown(code = 0) {
    try {
        await server.close();
    }
    catch (_error) {
        // Ignore shutdown errors.
    }
    await (0, shared_1.shutdownMcpResources)();
    process.exit(code);
}
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
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
