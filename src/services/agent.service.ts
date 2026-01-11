import OpenAI from 'openai';
import { config } from 'dotenv';
import { AGENT_SYSTEM_PROMPT } from '../config/prompts';
import plannerService from './planner.service';
import publisherService from './publisher.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import generatorService from './generator.service';
import { format } from 'date-fns';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class AgentService {
    private history: any[] = [];

    async processMessage(text: string) {
        this.history.push({ role: 'user', content: text });

        const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
            {
                type: 'function',
                function: {
                    name: 'plan_next_week',
                    description: 'Создать план постов на следующую свободную неделю по заданной теме',
                    parameters: {
                        type: 'object',
                        properties: {
                            theme: { type: 'string', description: 'Тема недели' }
                        },
                        required: ['theme']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'get_current_status',
                    description: 'Получить отчет о текущих планах и статусе постов',
                    parameters: { type: 'object', properties: {} }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'publish_post_instantly',
                    description: 'Мгновенно опубликовать конкретный утвержденный пост в канал',
                    parameters: {
                        type: 'object',
                        properties: {
                            postId: { type: 'number', description: 'ID поста' }
                        },
                        required: ['postId']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'search_posts',
                    description: 'Найти посты по ключевым словам в теме или тексте',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Поисковый запрос' }
                        },
                        required: ['query']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'create_and_schedule_post',
                    description: 'Создать отдельный пост с указанным текстом и поставить его на публикацию в заданное время',
                    parameters: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string', description: 'Тема поста' },
                            text: { type: 'string', description: 'Полный текст поста' },
                            publishTime: { type: 'string', description: 'Время публикации в формате ISO или относительное (например, "через 5 минут", "завтра в 10:00")' }
                        },
                        required: ['topic', 'text', 'publishTime']
                    }
                }
            }
        ];

        let response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: AGENT_SYSTEM_PROMPT },
                ...this.history
            ],
            tools,
            temperature: 0.7
        });

        let message = response.choices[0].message;

        if (message.tool_calls) {
            this.history.push(message);

            for (const toolCall of message.tool_calls) {
                const name = (toolCall as any).function.name;
                const args = JSON.parse((toolCall as any).function.arguments);
                let result;

                console.log(`Agent calling tool: ${name} with args:`, args);

                try {
                    if (name === 'plan_next_week') {
                        const { start, end } = await plannerService.getNextWeekRange();
                        const week = await plannerService.createWeek(1, args.theme, start, end);
                        await plannerService.generateSlots(week.id, 1, start);
                        const topics = await generatorService.generateTopics(args.theme);
                        // topics is now { topic, category, tags }[]
                        await plannerService.saveTopics(week.id, topics);
                        result = { success: true, message: `План создан на ${format(start, 'dd.MM')} - ${format(end, 'dd.MM')}. Темы сгенерированы.`, weekId: week.id };
                    } else if (name === 'get_current_status') {
                        const weeks = await prisma.week.findMany({
                            take: 3,
                            orderBy: { week_start: 'desc' },
                            include: { posts: true }
                        });
                        result = weeks.map((w: any) => ({
                            id: w.id,
                            theme: w.theme,
                            start: format(w.week_start, 'dd.MM'),
                            status: w.status,
                            postCount: w.posts.length
                        }));
                    } else if (name === 'publish_post_instantly') {
                        // For MVP, just update status to scheduled and call publishDuePosts
                        const post = await prisma.post.update({
                            where: { id: args.postId },
                            data: { status: 'scheduled', publish_at: new Date() }
                        });
                        await publisherService.publishDuePosts();
                        result = { success: true, message: `Пост "${post.topic}" опубликован.` };
                    } else if (name === 'search_posts') {
                        const posts = await prisma.post.findMany({
                            where: {
                                OR: [
                                    { topic: { contains: (args as any).query, mode: 'insensitive' } },
                                    { generated_text: { contains: (args as any).query, mode: 'insensitive' } }
                                ]
                            },
                            take: 5
                        });
                        result = posts.map((p: any) => ({ id: p.id, topic: p.topic, status: p.status, date: format(p.publish_at, 'dd.MM HH:mm') }));
                    } else if (name === 'create_and_schedule_post') {
                        // Parse publish time
                        let publishAt: Date;
                        const timeStr = (args as any).publishTime.toLowerCase();

                        if (timeStr.includes('сейчас') || timeStr.includes('немедленно')) {
                            publishAt = new Date();
                        } else if (timeStr.includes('через')) {
                            const minutes = parseInt(timeStr.match(/\d+/)?.[0] || '5');
                            publishAt = new Date(Date.now() + minutes * 60 * 1000);
                        } else {
                            try {
                                publishAt = new Date((args as any).publishTime);
                            } catch {
                                publishAt = new Date();
                            }
                        }

                        // Find or create a default "Standalone" week
                        let standaloneWeek = await prisma.week.findFirst({
                            where: { theme: 'Standalone Posts' }
                        });

                        if (!standaloneWeek) {
                            standaloneWeek = await prisma.week.create({
                                data: {
                                    channel_id: 1,
                                    theme: 'Standalone Posts',
                                    week_start: new Date('2020-01-01'),
                                    week_end: new Date('2099-12-31'),
                                    status: 'completed'
                                }
                            });
                        }

                        // Create a standalone post
                        const post = await prisma.post.create({
                            data: {
                                channel_id: 1,
                                week_id: standaloneWeek.id,
                                topic: (args as any).topic,
                                generated_text: (args as any).text,
                                final_text: (args as any).text,
                                publish_at: publishAt,
                                slot_date: publishAt,
                                slot_index: 1,
                                topic_index: 0,
                                status: publishAt <= new Date() ? 'scheduled' : 'scheduled'
                            }
                        });

                        if (publishAt <= new Date()) {
                            await publisherService.publishDuePosts();
                            result = { success: true, message: `Пост "${post.topic}" создан и опубликован немедленно!` };
                        } else {
                            result = { success: true, message: `Пост "${post.topic}" создан и запланирован на ${format(publishAt, 'dd.MM HH:mm')}.`, postId: post.id };
                        }
                    }
                } catch (err: any) {
                    console.error(`Tool error: ${name}`, err);
                    result = { error: err.message };
                }

                this.history.push({
                    role: 'tool',
                    tool_call_id: (toolCall as any).id,
                    content: JSON.stringify(result)
                });
            }

            response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: AGENT_SYSTEM_PROMPT },
                    ...this.history
                ]
            });
        }

        const finalContent = response.choices[0].message.content || 'Извини, я не смог сформулировать ответ.';
        this.history.push({ role: 'assistant', content: finalContent });

        if (this.history.length > 20) {
            this.history = this.history.slice(-20);
        }

        return finalContent;
    }
}

export default new AgentService();
