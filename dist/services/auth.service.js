"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const bcrypt = __importStar(require("bcrypt"));
const jwt = __importStar(require("jsonwebtoken"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '7d';
class AuthService {
    async register(email, password, name) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new Error('User already exists');
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                name,
                password_hash: passwordHash
            }
        });
        const token = this.generateToken(user);
        return { user: this.sanitizeUser(user), token };
    }
    async login(email, password) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error('Invalid email or password');
        }
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            throw new Error('Invalid email or password');
        }
        const token = this.generateToken(user);
        return { user: this.sanitizeUser(user), token };
    }
    generateToken(user) {
        return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    }
    verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        }
        catch (e) {
            throw new Error('Invalid token');
        }
    }
    sanitizeUser(user) {
        const { password_hash, ...sanitized } = user;
        return sanitized;
    }
    async getUserProjects(userId) {
        const memberships = await prisma.projectMember.findMany({
            where: { user_id: userId },
            include: { project: true }
        });
        return memberships.map(m => ({
            ...m.project,
            role: m.role
        }));
    }
    async hasProjectAccess(userId, projectId, minRole = 'viewer') {
        const membership = await prisma.projectMember.findUnique({
            where: {
                project_id_user_id: {
                    project_id: projectId,
                    user_id: userId
                }
            }
        });
        if (!membership)
            return false;
        const roles = ['viewer', 'editor', 'owner'];
        return roles.indexOf(membership.role) >= roles.indexOf(minRole);
    }
}
exports.default = new AuthService();
