import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '7d';

export interface AuthUser {
    id: number;
    email: string;
    name: string;
}

class AuthService {
    async register(email: string, password: string, name?: string) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new Error('User already exists');
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const finalName = name || email.split('@')[0];
        const user = await prisma.user.create({
            data: {
                email,
                name: finalName,
                password_hash: passwordHash
            }
        });

        // Create default project
        const project = await prisma.project.create({
            data: {
                name: `${finalName}'s Project`,
                slug: `${finalName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-project-${Date.now()}`, // Ensure unique slug
                members: {
                    create: {
                        user_id: user.id,
                        role: 'owner'
                    }
                },
                // Create default settings
                settings: {
                    createMany: {
                        data: [
                            { key: 'post_creator_prompt', value: 'You are a helpful assistant.' },
                            { key: 'post_creator_model', value: 'gpt-4' }
                        ]
                    }
                }
            }
        });

        const token = this.generateToken(user);
        // Fetch the project again to match the expected format or just construct it
        // But getUserProjects returns what we need
        const projects = await this.getUserProjects(user.id);

        return { user: this.sanitizeUser(user), token, projects };
    }

    async login(email: string, password: string) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error('Invalid email or password');
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            throw new Error('Invalid email or password');
        }

        const token = this.generateToken(user);
        const projects = await this.getUserProjects(user.id);
        return { user: this.sanitizeUser(user), token, projects };
    }

    private generateToken(user: any) {
        return jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
    }

    verifyToken(token: string): AuthUser {
        try {
            return jwt.verify(token, JWT_SECRET) as AuthUser;
        } catch (e) {
            throw new Error('Invalid token');
        }
    }

    private sanitizeUser(user: any) {
        const { password_hash, ...sanitized } = user;
        return sanitized;
    }

    async getUserProjects(userId: number) {
        const memberships = await prisma.projectMember.findMany({
            where: { user_id: userId },
            include: { project: true }
        });
        return memberships.map(m => ({
            ...m.project,
            role: m.role
        }));
    }

    async hasProjectAccess(userId: number, projectId: number, minRole: 'owner' | 'editor' | 'viewer' = 'viewer') {
        const membership = await prisma.projectMember.findUnique({
            where: {
                project_id_user_id: {
                    project_id: projectId,
                    user_id: userId
                }
            }
        });

        if (!membership) return false;

        const roles = ['viewer', 'editor', 'owner'];
        return roles.indexOf(membership.role) >= roles.indexOf(minRole);
    }
}

export default new AuthService();
