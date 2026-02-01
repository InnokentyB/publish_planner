"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const multi_agent_service_1 = __importDefault(require("./services/multi_agent.service"));
async function testFixerPrompt() {
    console.log('--- Testing Improved Fixer Prompt ---\n');
    try {
        const result = await multi_agent_service_1.default.runPostGeneration(1, 'Soft Skills for Developers', 'How to give and receive constructive feedback');
        console.log('\n✅ Generation completed!');
        console.log(`Final Score: ${result.score}`);
        console.log(`Iterations: ${result.iterations}`);
        console.log(`\nFinal Text Preview (first 500 chars):\n${result.finalText.substring(0, 500)}...`);
        // Check if it starts with meta-commentary
        const metaPhrases = ['Замечательная работа', 'Анализ критики', 'Переписывание', 'Улучшенная версия', 'Here\'s the improved'];
        const hasMeta = metaPhrases.some(phrase => result.finalText.includes(phrase));
        if (hasMeta) {
            console.log('\n⚠️  WARNING: Text still contains meta-commentary!');
        }
        else {
            console.log('\n✅ SUCCESS: No meta-commentary detected.');
        }
    }
    catch (e) {
        console.error('Error:', e);
    }
    process.exit(0);
}
testFixerPrompt();
