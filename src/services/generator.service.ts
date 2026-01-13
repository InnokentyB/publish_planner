import OpenAI from 'openai';
import { config } from 'dotenv';
import { POST_SYSTEM_PROMPT } from '../config/prompts';

config();

class GeneratorService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async generateTopics(theme: string): Promise<{ topic: string, category: string, tags: string[] }[]> {
        const prompt = `
    Сгенерируй 14 уникальных и интересных тем для постов в Telegram-канале.
    Тема недели: "${theme}".
    
    Для каждой темы укажи категорию из списка: "Soft Skills", "Technologies", "Integrations", "Requirements".
    Также сгенерируй 2-4 тега для каждого поста.

    Верни ТОЛЬКО JSON массив объектов. Без markdown форматирования.
    Пример: [{"topic": "Тема 1", "category": "Soft Skills", "tags": ["tag1", "tag2"]}]
    `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini', // or 'gpt-3.5-turbo' if preferred
            messages: [{ role: 'user', content: prompt }],
        });

        try {
            const content = response.choices[0].message.content || '[]';
            // Clean potential markdown code blocks
            const clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const topics = JSON.parse(clean);

            // Validate that we got objects, not just strings
            if (topics.length > 0 && typeof topics[0] === 'string') {
                // Fallback if model returned strings
                return topics.map((t: string) => ({ topic: t, category: 'Technologies', tags: [] }));
            }

            return topics;
        } catch (e) {
            console.error('Failed to parse topics', e);
            return [];
        }
    }

    async generatePostText(theme: string, topic: string) {
        const prompt = `
        Тема недели: ${theme}
        Тема поста: ${topic}
        
        Напиши максимально подробный, экспертный и глубокий пост, используя свой системный промпт.
        Текст должен быть объемом от 3000 до 4000 символов.
        `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: POST_SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7
        });

        return response.choices[0].message.content || '';
    }

    async generateImagePrompt(topic: string, text: string): Promise<string> {
        const prompt = `
        На основе темы и текста поста создай детальный промпт для генерации иллюстрации в DALL-E 3.
        
        Тема: ${topic}
        Текст (фрагмент): ${text.substring(0, 500)}...

        Требования к иллюстрации:
        - Стиль: Современный, минималистичный, технологичный (IT, Digital).
        - Цвета: Спокойные, профессиональные.
        - Без текста на изображении.
        - Абстракции, схемы, или метафорические образы, подходящие для IT-аналитики.

        Верни ТОЛЬКО текст промпта на английском языке.
        `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o', // Using 4o for better prompt engineering
            messages: [{ role: 'user', content: prompt }],
        });

        return response.choices[0].message.content || '';
    }

    async generateImage(prompt: string): Promise<string> {
        try {
            const response = await this.openai.images.generate({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
                quality: "standard",
                response_format: "url",
            });

            if (!response.data || !response.data[0]) {
                throw new Error('No image data returned from DALL-E');
            }

            return response.data[0].url || '';
        } catch (e) {
            console.error('Failed to generate image', e);
            throw e;
        }
    }
}

export default new GeneratorService();
