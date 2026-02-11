"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const multi_agent_service_1 = __importDefault(require("./services/multi_agent.service"));
async function main() {
    console.log('Testing Multi-Agent Topic Generation...');
    // Test with a simple theme
    const theme = 'AI Agents in 2025';
    try {
        const { topics, score } = await multi_agent_service_1.default.refineTopics(1, theme, -1);
        console.log('\n--- Final Topics ---');
        console.log(`Score: ${score}/100`);
        console.log(JSON.stringify(topics, null, 2));
        if (topics.length > 0) {
            console.log(`\nSUCCESS: Generated ${topics.length} topics.`);
        }
        else {
            console.error('\nFAILURE: No topics generated.');
        }
    }
    catch (error) {
        console.error('Error during test:', error);
    }
    finally {
        // Force exit since the internal pool might keep the process alive
        process.exit(0);
    }
}
main();
