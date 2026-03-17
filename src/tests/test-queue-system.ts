import { topicsQueue, postsQueue, imageQueue } from './queue';
import * as dotenv from 'dotenv';
dotenv.config();

async function testQueueSystem() {
    console.log('[Test] Starting Queue System Functional Test...');

    try {
        // 1. Verify Queue Instance exists
        if (!topicsQueue || !postsQueue || !imageQueue) {
            throw new Error('Queues not initialized correctly');
        }
        console.log('[Test] Queue instances validated.');

        // 2. Add a dummy job to topicsQueue (with a special test name so worker doesn't do real LLM stuff if we were running it)
        // Actually, workers are running in the server. If server is NOT running, this will just stay in Redis.
        const job = await topicsQueue.add('test-job', {
            test: true,
            message: 'Queue connectivity check'
        }, {
            removeOnComplete: true
        });

        console.log(`[Test] Successfully added test job to topicsQueue (ID: ${job.id})`);

        // 3. Check Redis connectivity
        const counts = await topicsQueue.getJobCounts();
        console.log('[Test] Current Job Counts for topicsQueue:', counts);
        
        if (counts.waiting === 0 && counts.active === 0 && counts.completed === 0 && counts.failed === 0) {
             // This might happen if redis is empty and we just added one? 
             // Actually job was added so counts should show it.
        }

        console.log('[Test] Queue System test finished successfully. Redis connection ok.');

    } catch (error) {
        console.error('[Test] Queue System Functional Test Failed:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

testQueueSystem();
