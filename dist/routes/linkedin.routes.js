"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = linkedinRoutes;
const linkedin_service_1 = __importDefault(require("../services/linkedin.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function linkedinRoutes(fastify) {
    // GET /api/auth/linkedin/connect?projectId=123
    fastify.get('/api/auth/linkedin/connect', async (request, reply) => {
        // Here we ideally verify if the user has auth/token in query or cookies to check rights,
        // but since this is OAuth redirect, we often pass it via a UI click.
        const { projectId } = request.query;
        if (!projectId) {
            return reply.code(400).send({ error: 'projectId is required' });
        }
        const url = linkedin_service_1.default.getAuthUrl(Number(projectId));
        // Redirect browser to LinkedIn
        reply.redirect(url);
    });
    // GET /api/auth/linkedin/callback
    fastify.get('/api/auth/linkedin/callback', async (request, reply) => {
        const { code, state, error, error_description } = request.query;
        if (error) {
            console.error(`LinkedIn Auth Error: ${error} - ${error_description}`);
            // Redirect back to frontend with error
            return reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?error=linkedin_auth_failed`);
        }
        if (!code || !state) {
            return reply.code(400).send({ error: 'Code or state missing' });
        }
        try {
            // Parse state to get project ID
            const decodedState = JSON.parse(decodeURIComponent(state));
            const projectId = Number(decodedState.projectId);
            if (!projectId || isNaN(projectId))
                throw new Error('Invalid state payload');
            // 1. Exchange code for access token
            const token = await linkedin_service_1.default.exchangeCodeToToken(code);
            // 2. Fetch User Profile to get URN and Name
            const { urn, name } = await linkedin_service_1.default.getUserProfile(token);
            // 3. Save as SocialChannel in the project
            await prisma.socialChannel.create({
                data: {
                    project_id: projectId,
                    type: 'linkedin',
                    name: `LinkedIn: ${name}`,
                    config: {
                        linkedin_urn: urn,
                        access_token: token
                    }
                }
            });
            // Redirect back to frontend settings page on success
            reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings`);
        }
        catch (err) {
            console.error('[LinkedIn OAuth] Error sorting callback:', err);
            reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?error=linkedin_auth_error`);
        }
    });
}
