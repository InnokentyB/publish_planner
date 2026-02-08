import multiAgentService from './services/multi_agent.service';

async function testFixerPrompt() {
    console.log('--- Testing Improved Fixer Prompt ---\n');

    try {
        const result = await multiAgentService.runPostGeneration(1,
            'Soft Skills for Developers',
            'How to give and receive constructive feedback',
            -1
        );

        console.log('\n✅ Generation completed!');
        console.log(`Final Score: ${result.score}`);
        console.log(`Iterations: ${result.iterations}`);
        console.log(`\nFinal Text Preview (first 500 chars):\n${result.finalText.substring(0, 500)}...`);

        // Check if it starts with meta-commentary
        const metaPhrases = ['Замечательная работа', 'Анализ критики', 'Переписывание', 'Улучшенная версия', 'Here\'s the improved'];
        const hasMeta = metaPhrases.some(phrase => result.finalText.includes(phrase));

        if (hasMeta) {
            console.log('\n⚠️  WARNING: Text still contains meta-commentary!');
        } else {
            console.log('\n✅ SUCCESS: No meta-commentary detected.');
        }

    } catch (e) {
        console.error('Error:', e);
    }

    process.exit(0);
}

testFixerPrompt();
