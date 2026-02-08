
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ModelInfo {
    id: string;
    object: string;
    owned_by?: string;
}

class ModelService {
    async fetchModels(provider: string, apiKey: string): Promise<string[]> {
        if (!apiKey) return [];

        try {
            if (provider.toLowerCase() === 'openai') {
                return await this.fetchOpenAIModels(apiKey);
            } else if (provider.toLowerCase() === 'gemini' || provider.toLowerCase() === 'google') {
                return await this.fetchGeminiModels(apiKey);
            } else if (provider.toLowerCase() === 'anthropic') {
                return this.getAnthropicModels(); // API listing is not always straightforward, simplified list for now
            }
        } catch (error) {
            console.error(`Failed to fetch models for ${provider}`, error);
            return [];
        }

        return [];
    }

    private async fetchOpenAIModels(apiKey: string): Promise<string[]> {
        const openai = new OpenAI({ apiKey });
        const list = await openai.models.list();
        return list.data
            .filter(m => m.id.includes('gpt')) // Filter for GPT models primarily
            .map(m => m.id)
            .sort();
    }

    private async fetchGeminiModels(apiKey: string): Promise<string[]> {
        // Simple fetch to Google AI Studio API for models
        // Or using the SDK
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            // SDK doesn't expose listModels directly on the main class in all versions, 
            // but we can try the REST API or updated SDK methods. 
            // For stability/speed in this version, let's use a known list or REST if possible.
            // Actually, let's use the REST endpoint for listing models.

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (!response.ok) throw new Error('Failed to fetch Gemini models');

            const data = await response.json();
            if (data.models) {
                return data.models.map((m: any) => m.name.replace('models/', ''));
            }
        } catch (e) {
            console.error(e);
        }

        // Fallback
        return ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    }

    private getAnthropicModels(): string[] {
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

export default new ModelService();
