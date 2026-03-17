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
const queue_1 = require("../queue");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
async function testQueueSystem() {
    console.log('[Test] Starting Queue System Functional Test...');
    try {
        // 1. Verify Queue Instance exists
        if (!queue_1.topicsQueue || !queue_1.postsQueue || !queue_1.imageQueue) {
            throw new Error('Queues not initialized correctly');
        }
        console.log('[Test] Queue instances validated.');
        // 2. Add a dummy job to topicsQueue (with a special test name so worker doesn't do real LLM stuff if we were running it)
        // Actually, workers are running in the server. If server is NOT running, this will just stay in Redis.
        const job = await queue_1.topicsQueue.add('test-job', {
            test: true,
            message: 'Queue connectivity check'
        }, {
            removeOnComplete: true
        });
        console.log(`[Test] Successfully added test job to topicsQueue (ID: ${job.id})`);
        // 3. Check Redis connectivity
        const counts = await queue_1.topicsQueue.getJobCounts();
        console.log('[Test] Current Job Counts for topicsQueue:', counts);
        if (counts.waiting === 0 && counts.active === 0 && counts.completed === 0 && counts.failed === 0) {
            // This might happen if redis is empty and we just added one? 
            // Actually job was added so counts should show it.
        }
        console.log('[Test] Queue System test finished successfully. Redis connection ok.');
    }
    catch (error) {
        console.error('[Test] Queue System Functional Test Failed:', error);
        process.exit(1);
    }
    finally {
        process.exit(0);
    }
}
testQueueSystem();
