import multiAgentService from './services/multi_agent.service';

async function main() {
    console.log('Testing Multi-Agent Topic Generation...');

    // Test with a simple theme
    const theme = 'AI Agents in 2025';
    try {
        const { topics, score } = await multiAgentService.refineTopics(1, theme);

        console.log('\n--- Final Topics ---');
        console.log(`Score: ${score}/100`);
        console.log(JSON.stringify(topics, null, 2));

        if (topics.length > 0) {
            console.log(`\nSUCCESS: Generated ${topics.length} topics.`);
        } else {
            console.error('\nFAILURE: No topics generated.');
        }

    } catch (error) {
        console.error('Error during test:', error);
    } finally {
        // Force exit since the internal pool might keep the process alive
        process.exit(0);
    }
}

main();
