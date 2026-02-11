"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class CommentService {
    async createComment(projectId, entityType, entityId, text, authorRole = 'user') {
        return await prisma.comment.create({
            data: {
                project_id: projectId,
                entity_type: entityType,
                entity_id: entityId,
                text,
                author_role: authorRole
            }
        });
    }
    async getComments(projectId, entityType, entityId) {
        return await prisma.comment.findMany({
            where: {
                project_id: projectId,
                entity_type: entityType,
                entity_id: entityId
            },
            orderBy: { created_at: 'asc' }
        });
    }
    // Helper to format comments as a dialogue string for LLM context
    async getCommentsForContext(projectId, entityType, entityId) {
        const comments = await this.getComments(projectId, entityType, entityId);
        if (comments.length === 0)
            return '';
        return comments.map(c => `${c.author_role === 'user' ? 'User' : 'Agent'}: ${c.text}`).join('\n');
    }
}
exports.default = new CommentService();
