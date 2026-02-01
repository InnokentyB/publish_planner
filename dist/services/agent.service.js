"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = __importDefault(require("openai"));
const dotenv_1 = require("dotenv");
const prompts_1 = require("../config/prompts");
const planner_service_1 = __importDefault(require("./planner.service"));
const publisher_service_1 = __importDefault(require("./publisher.service"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const generator_service_1 = __importDefault(require("./generator.service"));
const multi_agent_service_1 = __importDefault(require("./multi_agent.service"));
const date_fns_1 = require("date-fns");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const openai = new openai_1.default({
    apiKey: process.env.OPENAI_API_KEY,
});
class AgentService {
    constructor() {
        this.history = [];
    }
    async processMessage(text, projectId = 1) {
        this.history.push({ role: 'user', content: text });
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'plan_next_week',
                    description: 'Создать план постов на неделю по заданной теме. Можно указать конкретную дату начала (или "текущая неделя"), иначе будет выбрана следующая свободная.',
                    parameters: {
                        type: 'object',
                        properties: {
                            theme: { type: 'string', description: 'Тема недели' },
                            startDate: { type: 'string', description: 'Дата начала недели (или любая дата внутри недели) в формате YYYY-MM-DD или описание "текущая неделя".' }
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
            },
            {
                type: 'function',
                function: {
                    name: 'create_refined_post',
                    description: 'Создать качественный пост с помощью мульти-агентной системы (Создатель -> Критик -> Исправитель). Используй это для создания контента.',
                    parameters: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string', description: 'Тема поста' }
                        },
                        required: ['topic']
                    }
                }
            }
        ];
        let response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: `${prompts_1.AGENT_SYSTEM_PROMPT}\n\nТекущая дата: ${new Date().toISOString()}` },
                ...this.history
            ],
            tools,
            temperature: 0.7
        });
        let message = response.choices[0].message;
        if (message.tool_calls) {
            this.history.push(message);
            for (const toolCall of message.tool_calls) {
                const name = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                let result;
                console.log(`Agent calling tool: ${name} with args:`, args);
                try {
                    if (name === 'plan_next_week') {
                        let start, end;
                        if (args.startDate) {
                            // Try to parse date
                            const date = new Date(args.startDate);
                            if (isNaN(date.getTime())) {
                                // Default checks if "current" or "this week"
                                const lower = args.startDate.toLowerCase();
                                if (lower.includes('текущ') || lower.includes('this') || lower.includes('сейчас')) {
                                    const range = await planner_service_1.default.getCurrentWeekRange();
                                    start = range.start;
                                    end = range.end;
                                }
                                else {
                                    throw new Error(`Invalid date format: ${args.startDate}`);
                                }
                            }
                            else {
                                const range = await planner_service_1.default.getWeekRangeForDate(date);
                                start = range.start;
                                end = range.end;
                            }
                        }
                        else {
                            const range = await planner_service_1.default.getNextWeekRange();
                            start = range.start;
                            end = range.end;
                        }
                        console.log(`Planning for week: ${(0, date_fns_1.format)(start, 'yyyy-MM-dd')} - ${(0, date_fns_1.format)(end, 'yyyy-MM-dd')}`);
                        const week = await planner_service_1.default.createWeek(projectId, args.theme, start, end);
                        await planner_service_1.default.generateSlots(week.id, projectId, start);
                        const { topics } = await generator_service_1.default.generateTopics(projectId, args.theme);
                        // topics is now { topic, category, tags }[]
                        await planner_service_1.default.saveTopics(week.id, topics);
                        result = { success: true, message: `План создан на ${(0, date_fns_1.format)(start, 'dd.MM')} - ${(0, date_fns_1.format)(end, 'dd.MM')}. Темы сгенерированы.`, weekId: week.id };
                    }
                    else if (name === 'get_current_status') {
                        const weeks = await prisma.week.findMany({
                            where: { project_id: projectId },
                            take: 3,
                            orderBy: { week_start: 'desc' },
                            include: { posts: true }
                        });
                        result = weeks.map((w) => ({
                            id: w.id,
                            theme: w.theme,
                            start: (0, date_fns_1.format)(w.week_start, 'dd.MM'),
                            status: w.status,
                            postCount: w.posts.length
                        }));
                    }
                    else if (name === 'publish_post_instantly') {
                        // For MVP, just update status to scheduled and call publishDuePosts
                        const post = await prisma.post.update({
                            where: { id: args.postId },
                            data: { status: 'scheduled', publish_at: new Date() }
                        });
                        await publisher_service_1.default.publishDuePosts();
                        result = { success: true, message: `Пост "${post.topic}" опубликован.` };
                    }
                    else if (name === 'search_posts') {
                        const posts = await prisma.post.findMany({
                            where: {
                                OR: [
                                    { topic: { contains: args.query, mode: 'insensitive' } },
                                    { generated_text: { contains: args.query, mode: 'insensitive' } }
                                ]
                            },
                            take: 5
                        });
                        result = posts.map((p) => ({ id: p.id, topic: p.topic, status: p.status, date: (0, date_fns_1.format)(p.publish_at, 'dd.MM HH:mm') }));
                    }
                    else if (name === 'create_and_schedule_post') {
                        // Parse publish time
                        let publishAt;
                        const timeStr = args.publishTime.toLowerCase();
                        if (timeStr.includes('сейчас') || timeStr.includes('немедленно')) {
                            publishAt = new Date();
                        }
                        else if (timeStr.includes('через')) {
                            const minutes = parseInt(timeStr.match(/\d+/)?.[0] || '5');
                            publishAt = new Date(Date.now() + minutes * 60 * 1000);
                        }
                        else {
                            try {
                                publishAt = new Date(args.publishTime);
                            }
                            catch {
                                publishAt = new Date();
                            }
                        }
                        // Find or create a default "Standalone" week
                        let standaloneWeek = await prisma.week.findFirst({
                            where: { theme: 'Standalone Posts', project_id: projectId }
                        });
                        if (!standaloneWeek) {
                            standaloneWeek = await prisma.week.create({
                                data: {
                                    project_id: projectId,
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
                                project_id: projectId,
                                week_id: standaloneWeek.id,
                                topic: args.topic,
                                generated_text: args.text,
                                final_text: args.text,
                                publish_at: publishAt,
                                slot_date: publishAt,
                                slot_index: 1,
                                topic_index: 0,
                                status: publishAt <= new Date() ? 'scheduled' : 'scheduled'
                            }
                        });
                        if (publishAt <= new Date()) {
                            await publisher_service_1.default.publishDuePosts();
                            result = { success: true, message: `Пост "${post.topic}" создан и опубликован немедленно!` };
                        }
                        else {
                            result = { success: true, message: `Пост "${post.topic}" создан и запланирован на ${(0, date_fns_1.format)(publishAt, 'dd.MM HH:mm')}.`, postId: post.id };
                        }
                    }
                    else if (name === 'create_refined_post') {
                        const multiResult = await multi_agent_service_1.default.runPostGeneration(projectId, 'Custom Request', args.topic);
                        result = {
                            success: true,
                            data: multiResult,
                            message: `Пост создан! Итоговый балл: ${multiResult.score} после ${multiResult.iterations} итераций.\n\nТекст:\n${multiResult.finalText}`
                        };
                    }
                }
                catch (err) {
                    console.error(`Tool error: ${name}`, err);
                    result = { error: err.message };
                }
                this.history.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result)
                });
            }
            response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: prompts_1.AGENT_SYSTEM_PROMPT },
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
exports.default = new AgentService();
