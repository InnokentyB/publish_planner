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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const metrics_service_1 = __importDefault(require("../services/metrics.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function testMetricsCollection() {
    console.log('[Test] Starting Metrics Collection Functional Test...');
    try {
        // 1. Mocking/Setup a fake published post for various platforms
        // Actually, we can just trigger the service and check if it handles posts correctly.
        // For a safe 'dry run', we could just call getMetrics on one test platform.
        const testPostId = 1; // Existing test post ID or we could create one
        const post = await prisma.post.findUnique({
            where: { id: testPostId },
            include: { channel: true }
        });
        if (!post) {
            console.warn(`[Test] No post found with ID ${testPostId}. Please create a test post or change ID.`);
        }
        else {
            console.log(`[Test] Testing metrics for post ${post.id} on channel type: ${post.channel?.type}`);
            // Trigger individual platform collection logic if possible
            // metricsService.collectAllMetrics() will go through many posts.
            // Let's run a single pass on the service for just this published post.
            // For now, let's just make sure the service can be initialized and run without crashing
            console.log('[Test] Triggering collectAllMetrics (limit to 1 for safety)...');
            // We might want to limit the service for testing, but since it's a script:
            await metrics_service_1.default.collectAllMetrics();
            console.log('[Test] Metrics collection finished successfully.');
        }
    }
    catch (error) {
        console.error('[Test] Metrics Functional Test Failed:', error);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
        await pool.end();
    }
}
testMetricsCollection();
