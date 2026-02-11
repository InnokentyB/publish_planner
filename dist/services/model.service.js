"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = __importDefault(require("openai"));
const generative_ai_1 = require("@google/generative-ai");
class ModelService {
    async fetchModels(provider, apiKey) {
        if (!apiKey)
            return [];
        try {
            if (provider.toLowerCase() === 'openai') {
                return await this.fetchOpenAIModels(apiKey);
            }
            else if (provider.toLowerCase() === 'gemini' || provider.toLowerCase() === 'google') {
                return await this.fetchGeminiModels(apiKey);
            }
            else if (provider.toLowerCase() === 'anthropic') {
                return this.getAnthropicModels(); // API listing is not always straightforward, simplified list for now
            }
        }
        catch (error) {
            console.error(`Failed to fetch models for ${provider}`, error);
            return [];
        }
        return [];
    }
    async fetchOpenAIModels(apiKey) {
        const openai = new openai_1.default({ apiKey });
        const list = await openai.models.list();
        return list.data
            .filter(m => m.id.includes('gpt')) // Filter for GPT models primarily
            .map(m => m.id)
            .sort();
    }
    async fetchGeminiModels(apiKey) {
        // Simple fetch to Google AI Studio API for models
        // Or using the SDK
        try {
            const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
            // SDK doesn't expose listModels directly on the main class in all versions, 
            // but we can try the REST API or updated SDK methods. 
            // For stability/speed in this version, let's use a known list or REST if possible.
            // Actually, let's use the REST endpoint for listing models.
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (!response.ok)
                throw new Error('Failed to fetch Gemini models');
            const data = await response.json();
            if (data.models) {
                return data.models.map((m) => m.name.replace('models/', ''));
            }
        }
        catch (e) {
            console.error(e);
        }
        // Fallback
        return ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    }
    getAnthropicModels() {
        // Anthropic doesn't have a simple public "list models" endpoint for API keys yet (it varies).
        // Returning known stable list.
        return [
            'claude-3-5-sonnet-20240620',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307'
        ];
    }
}
exports.default = new ModelService();
