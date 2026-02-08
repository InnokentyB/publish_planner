import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { POST_SYSTEM_PROMPT } from '../config/prompts';
import multiAgentService from './multi_agent.service';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class GeneratorService {
    private openai!: OpenAI;
    private genAI: any;

    private PROMPT_KEY_DALLE = 'image_generation_prompt';
    private PROMPT_KEY_NANO = 'nano_banana_image_prompt';

    private DEFAULT_PROMPT_DALLE = "Create a modern, flat vector illustration for a tech blog post about: ${topic}. \n\nStyle: Minimalist, clean lines, corporate colors (blue, grey, white). \nUse metaphors related to: ${text.substring(0, 500)} \nNo text in the image.";
    private DEFAULT_PROMPT_NANO = "Generate a photorealistic image for a post about ${topic}. Context: ${text.substring(0, 500)}. High quality, professional lighting.";

    constructor() {
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
        }

        if (process.env.GOOGLE_API_KEY) {
            try {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
            } catch (e) {
                console.error('Failed to initialize Google AI', e);
            }
        }
    }

    async getImagePromptTemplate(projectId: number, provider: 'dalle' | 'nano' = 'dalle'): Promise<string> {
        const key = provider === 'nano' ? this.PROMPT_KEY_NANO : this.PROMPT_KEY_DALLE;
        const defaultPrompt = provider === 'nano' ? this.DEFAULT_PROMPT_NANO : this.DEFAULT_PROMPT_DALLE;

        const setting = await prisma.projectSettings.findUnique({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            }
        });

        if (setting) return setting.value;

        // If not set, initialize with default
        await prisma.projectSettings.create({
            data: {
                project_id: projectId,
                key: key,
                value: defaultPrompt
            }
        });

        return defaultPrompt;
    }

    async updateImagePromptTemplate(projectId: number, value: string, provider: 'dalle' | 'nano' = 'dalle') {
        const key = provider === 'nano' ? this.PROMPT_KEY_NANO : this.PROMPT_KEY_DALLE;

        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            },
            update: { value },
            create: { project_id: projectId, key: key, value }
        });
    }

    async generateTopics(projectId: number, theme: string, weekId: number, promptOverride?: string): Promise<{ topics: { topic: string, category: string, tags: string[] }[], score: number }> {
        return await multiAgentService.refineTopics(projectId, theme, weekId, promptOverride);
    }

    async generatePostText(projectId: number, theme: string, topic: string, postId: number, promptOverride?: string) {
        const result = await multiAgentService.runPostGeneration(projectId, theme, topic, postId, promptOverride);
        return {
            text: result.finalText,
            category: result.category,
            tags: result.tags
        };
    }

    async generateImagePrompt(projectId: number, topic: string, text: string, provider: 'dalle' | 'nano' = 'dalle'): Promise<string> {
        let template = await this.getImagePromptTemplate(projectId, provider);

        // Replace placeholders safely
        const filledPrompt = template
            .replace('${topic}', topic)
            .replace('${text.substring(0, 500)}', text.substring(0, 500));

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: filledPrompt }], // Simplification: just use the template as the prompt
        });

        const generatedPrompt = response.choices[0].message.content || '';

        return generatedPrompt;
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
            console.error('Failed to generate image (DALL-E)', e);
            throw e;
        }
    }

    async generateImageNanoBanana(prompt: string): Promise<string> {
        if (!process.env.GOOGLE_API_KEY) {
            throw new Error('GOOGLE_API_KEY is not set');
        }

        try {
            // Updated to use Imagen 4.0 as per available models list
            const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${process.env.GOOGLE_API_KEY}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    instances: [
                        { prompt: prompt }
                    ],
                    parameters: {
                        sampleCount: 1,
                        aspectRatio: "1:1" // Optional, but usually good for posts
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Google API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();

            // Check for valid response structure
            if (!data.predictions || !data.predictions[0] || !data.predictions[0].bytesBase64Encoded) {
                console.error("Unexpected Google API Query Response", JSON.stringify(data));
                throw new Error('No image data returned from Google Imagen');
            }

            const base64Image = data.predictions[0].bytesBase64Encoded;
            // Return as Data URI so it can be stored in the DB (Postgres TEXT field should handle ~500KB-1MB usually)
            // Just ensure generated image isn't too huge. Default standard quality usually fits.
            return `data:image/jpeg;base64,${base64Image}`;

        } catch (e) {
            console.error('Failed to generate image (Nano Banana)', e);
            throw e;
        }
    }
}

export default new GeneratorService();
