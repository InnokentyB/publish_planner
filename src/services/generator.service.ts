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

        try {
            const setting = await prisma.projectSettings.findUnique({
                where: {
                    project_id_key: {
                        project_id: projectId,
                        key: key
                    }
                }
            });

            if (setting) return setting.value;

            // If not set, initialize with default (safely)
            try {
                await prisma.projectSettings.create({
                    data: {
                        project_id: projectId,
                        key: key,
                        value: defaultPrompt
                    }
                });
            } catch (e) {
                // Ignore race condition if another process already created it
            }

            return defaultPrompt;
        } catch (e) {
            console.error(`Error fetching image prompt template for ${provider}`, e);
            return defaultPrompt;
        }
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

    async generateTopics(projectId: number, theme: string, weekId: number, promptOverride?: string, count: number = 5, existingTopics: string[] = []): Promise<{ topics: { topic: string, category: string, tags: string[] }[], score: number }> {
        return await multiAgentService.refineTopics(projectId, theme, weekId, promptOverride, count, existingTopics);
    }

    async generatePostText(projectId: number, theme: string, topic: string, postId: number, promptOverride?: string, withImage: boolean = false) {
        const result = await multiAgentService.runPostGeneration(projectId, theme, topic, postId, promptOverride, withImage);
        return {
            text: result.finalText,
            category: result.category,
            tags: result.tags
        };
    }

    async generateContentItemText(contentItemId: number) {
        const item = await prisma.contentItem.findUnique({
            where: { id: contentItemId },
            include: { week_package: true }
        });

        if (!item || !item.week_package) throw new Error("ContentItem or WeekPackage not found");

        const theme = item.week_package.week_theme || '';
        const topic = item.title || item.brief || 'Unknown topic';

        // For MVP, reuse the existing runPostGeneration logic but point it to this ContentItem's topic
        // A more advanced integration would pass the ContentItem's specific requirements (layer, CTA) 
        // to a dedicated v2 prompt.
        const promptOverride = `Ты — Автор контента. Тема недели: ${theme}. Тезис: ${item.week_package.core_thesis}.
Твоя задача — написать черновик:
Формат: ${item.type} (Слой: ${item.layer || 'общий'})
Заголовок: ${item.title}
Детали: ${item.brief}
Ключевые пункты: ${(item.key_points as string[] || []).join(', ')}
CTA: ${item.cta || 'Нет'}

Пиши сразу текст, без мета-комментариев.`;

        // Mocking postId as 0 since we capture the output directly and will save it to ContentItem manually
        const result = await multiAgentService.runPostGeneration(item.project_id, theme, topic, 0, promptOverride, false);

        await prisma.contentItem.update({
            where: { id: item.id },
            data: { draft_text: result.finalText, status: 'drafted', quality_report: result.history as any }
        });

        return result.finalText;
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

            const imageUrl = response.data[0].url || '';
            if (!imageUrl) throw new Error('Empty image URL from DALL-E');

            // Download and save locally
            const filename = `img-${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
            return await this.downloadAndSaveImage(imageUrl, filename);
        } catch (e) {
            console.error('Failed to generate image (DALL-E)', e);
            throw e;
        }
    }

    private async downloadAndSaveImage(url: string, filename: string): Promise<string> {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const storageService = require('./storage.service').default;
            return await storageService.uploadFileFromBuffer(buffer, 'image/png', `generated/${filename}`);
        } catch (e: any) {
            console.error('Failed to upload generated image to storage', e);
            throw e;
        }
    }

    async generateImageNanoBanana(prompt: string, referenceImageBase64?: string): Promise<string> {
        if (!process.env.GOOGLE_API_KEY) {
            throw new Error('GOOGLE_API_KEY is not set');
        }

        try {
            // Using Imagen 4.0 as per available models
            const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${process.env.GOOGLE_API_KEY}`;

            let instancesPayload: any[] = [{ prompt: prompt }];
            if (referenceImageBase64) {
                // Some Imagen versions accept reference images through the "image" field
                // If it fails, we will catch it and retry without the image
                instancesPayload = [{
                    prompt: prompt,
                    image: {
                        bytesBase64Encoded: referenceImageBase64.replace(/^data:image\/\w+;base64,/, '')
                    }
                }];
            }

            const sendRequest = async (payload: any[]) => {
                return await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instances: payload,
                        parameters: {
                            sampleCount: 1,
                            aspectRatio: "1:1"
                        }
                    })
                });
            };

            let response = await sendRequest(instancesPayload);

            if (!response.ok && referenceImageBase64) {
                const errorText = await response.text();
                console.warn(`[Nano Banana] Reference image rejected, falling back to prompt only. Error: ${errorText}`);
                // Fallback: send without the reference image
                response = await sendRequest([{ prompt: prompt }]);
            }

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
            return `data:image/jpeg;base64,${base64Image}`;

        } catch (e) {
            console.error('Failed to generate image (Nano Banana)', e);
            throw e;
        }
    }
}

export default new GeneratorService();
