import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { POST_SYSTEM_PROMPT } from '../config/prompts';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class GeneratorService {
    private openai: OpenAI;
    private readonly PROMPT_KEY = 'image_generation_prompt';
    // Default prompt backup
    private readonly DEFAULT_PROMPT = `
        You are an Image Prompt Engineer for an educational Telegram channel called
        “Аналитик, который думал”.
        
        Your task:
        Based on a Telegram post (topic + text), generate a clear, detailed image prompt
        for a professional illustration that visually supports the idea of the post.
        
        Context:
        The channel focuses on:
        - system analysis
        - product thinking
        - use cases
        - requirements
        - business context
        - analytical mistakes and insights
        Audience:
        IT professionals, analysts, product managers.
        
        Image goals:
        - Support thinking, not entertain
        - Convey abstract concepts via visual metaphors
        - Look professional, calm, and intelligent
        - Be suitable as a Telegram post image
        
        Style requirements:
        - Modern flat or semi-flat illustration
        - Soft neutral colors
        - Clean composition
        - Minimalistic
        - No text inside the image
        - No logos, watermarks, UI screenshots, or code snippets
        - No memes, no cartoons, no exaggerated emotions
        
        Preferred visual metaphors:
        - Person or small team thinking, discussing, or explaining
        - Whiteboard, sticky notes, diagrams (abstract, not literal)
        - Chaos vs structure
        - Light bulb, puzzle, system blocks, layers, flow
        - Analyst explaining complexity in a simple way
        
        Avoid:
        - Cartoon characters
        - Comic or childish style
        - Funny or meme aesthetics
        - Literal diagrams with readable text
        - Overloaded details
        - Dark, aggressive, or cyberpunk styles
        
        Output format:
        Return ONLY the final image prompt text in English.
        Do NOT include explanations, comments, or formatting.
        Do NOT mention Telegram, post length, or UI elements.
        
        Input you will receive:
        - Post topic \${topic}
        - Post text (may be long)\${text.substring(0, 500)}
        
        Your job is to:
        1) Extract the core idea of the post
        2) Choose a suitable visual metaphor
        3) Describe a single coherent illustration scene
        4) Produce a high-quality prompt ready for DALL·E image generation
        `;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async getImagePromptTemplate(): Promise<string> {
        const setting = await prisma.promptSettings.findUnique({
            where: { key: this.PROMPT_KEY }
        });

        if (setting) return setting.value;

        // If not set, initialize with default
        await prisma.promptSettings.create({
            data: {
                key: this.PROMPT_KEY,
                value: this.DEFAULT_PROMPT
            }
        });

        return this.DEFAULT_PROMPT;
    }

    async updateImagePromptTemplate(newPrompt: string): Promise<void> {
        await prisma.promptSettings.upsert({
            where: { key: this.PROMPT_KEY },
            update: { value: newPrompt },
            create: { key: this.PROMPT_KEY, value: newPrompt }
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
        let template = await this.getImagePromptTemplate();

        // Replace placeholders safely
        const filledPrompt = template
            .replace('${topic}', topic)
            .replace('${text.substring(0, 500)}', text.substring(0, 500));

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o', // Using 4o for better prompt engineering
            messages: [{ role: 'user', content: filledPrompt }],
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
