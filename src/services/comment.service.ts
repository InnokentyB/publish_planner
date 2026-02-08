import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class CommentService {
    async createComment(projectId: number, entityType: string, entityId: number, text: string, authorRole: string = 'user') {
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

    async getComments(projectId: number, entityType: string, entityId: number) {
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
    async getCommentsForContext(projectId: number, entityType: string, entityId: number): Promise<string> {
        const comments = await this.getComments(projectId, entityType, entityId);
        if (comments.length === 0) return '';

        return comments.map(c => `${c.author_role === 'user' ? 'User' : 'Agent'}: ${c.text}`).join('\n');
    }
}

export default new CommentService();
