## Railway service configs

This repository deploys multiple Railway services from the same codebase.

- `planner-app` must use [`planner-app.railway.json`](/Users/innokentyb/Ba_post_planner/ops/railway/planner-app.railway.json)
- `planner-mcp` must use [`planner-mcp.railway.json`](/Users/innokentyb/Ba_post_planner/ops/railway/planner-mcp.railway.json)

Do not use a shared root-level `railway.json` for both services.

Why:
- `planner-app` and `planner-mcp` have different start commands
- `planner-app` serves the main product UI and API
- `planner-mcp` serves the remote MCP runtime

Required runtime split:
- `planner-app` -> `npm run migrate:deploy && node dist/server.js`
- `planner-mcp` -> `node dist/mcp/remote-server.js`
