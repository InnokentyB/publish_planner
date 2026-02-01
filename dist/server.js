"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const dotenv_1 = require("dotenv");
const telegram_service_1 = __importDefault(require("./services/telegram.service"));
const jobs_1 = __importDefault(require("./routes/jobs"));
const webhook_1 = __importDefault(require("./routes/webhook"));
const api_routes_1 = __importDefault(require("./routes/api.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const project_routes_1 = __importDefault(require("./routes/project.routes"));
const path_1 = __importDefault(require("path"));
(0, dotenv_1.config)();
const server = (0, fastify_1.default)({
    logger: true
});
server.register(require('@fastify/cors'), {
    origin: true
});
server.register(require('@fastify/formbody'));
server.register(require('@fastify/static'), {
    root: path_1.default.join(__dirname, '../frontend/dist'),
    prefix: '/',
});
server.register(auth_routes_1.default);
server.register(project_routes_1.default);
server.register(api_routes_1.default);
server.register(webhook_1.default);
server.register(jobs_1.default);
const publisher_service_1 = __importDefault(require("./services/publisher.service"));
const start = async () => {
    try {
        // Initialize Telegram Bot
        await telegram_service_1.default.launch();
        await server.listen({ port: 3000, host: '0.0.0.0' });
        console.log('Server is running on port 3000');
        // Internal Scheduler: Check for due posts every 60 seconds
        console.log('Starting internal scheduler (every 60s)...');
        setInterval(async () => {
            try {
                const count = await publisher_service_1.default.publishDuePosts();
                if (count > 0) {
                    console.log(`[Scheduler] Published ${count} posts.`);
                }
            }
            catch (e) {
                console.error('[Scheduler] Error publishing due posts:', e);
            }
        }, 60000);
        // Run once immediately on startup
        publisher_service_1.default.publishDuePosts().catch(e => console.error('[Scheduler] Initial check failed:', e));
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
