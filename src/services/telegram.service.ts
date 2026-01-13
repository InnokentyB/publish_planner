import { Telegraf, Context, Markup } from 'telegraf';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { format } from 'date-fns';
import { config } from 'dotenv';
import plannerService from './planner.service';
import generatorService from './generator.service';
import publisherService from './publisher.service';
import agentService from './agent.service';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class TelegramService {
    public bot: Telegraf;
    private isWebhook = false;

    constructor() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            throw new Error('TELEGRAM_BOT_TOKEN is missing');
        }
        this.bot = new Telegraf(token);
        this.setupListeners();

        this.bot.catch((err, ctx) => {
            console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
        });
    }

    private setupListeners() {
        this.bot.command('start', async (ctx) => {
            await ctx.reply('Привет! Я планировщик контента. Что хочешь сделать?',
                Markup.keyboard([
                    ['📋 Список планов', '🗓 Текущая неделя'],
                    ['🔄 Сбросить всё']
                ]).resize()
            );
        });

        this.bot.hears('📋 Список планов', async (ctx) => {
            const weeks = await prisma.week.findMany({
                orderBy: { week_start: 'desc' },
                take: 10
            });
            if (weeks.length === 0) {
                await ctx.reply('Планов пока нет.');
                return;
            }
            const buttons = weeks.map(w => [
                Markup.button.callback(
                    `${format(new Date(w.week_start), 'dd.MM')} — ${format(new Date(w.week_end), 'dd.MM')} | ${w.theme}`,
                    `view_week_${w.id}`
                )
            ]);
            await ctx.reply('Последние планы:', Markup.inlineKeyboard(buttons));
        });

        this.bot.action(/^view_week_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const weekId = parseInt(ctx.match[1], 10);
            await this.sendWeekDetails(ctx, weekId);
        });

        this.bot.hears('🔄 Сбросить всё', async (ctx) => {
            await prisma.post.deleteMany({});
            await prisma.week.deleteMany({});
            await ctx.reply('База данных очищена! Отправь мне тему новой недели.');
        });

        this.bot.hears('🗓 Текущая неделя', async (ctx) => {
            const { start } = await plannerService.getCurrentWeekRange();
            const week = await plannerService.findWeekByDate(1, start);
            if (!week) {
                await ctx.reply('На ближайшую неделю планов еще нет. Пришлите тему!');
                return;
            }
            await this.sendWeekDetails(ctx, week.id);
        });

        this.bot.on('text', async (ctx: Context) => {
            console.log('Received text:', ctx.message);
            // @ts-ignore
            const text = ctx.message.text;
            // @ts-ignore
            const fromId = ctx.from.id;
            const ownerId = parseInt(process.env.OWNER_CHAT_ID || '0', 10);

            // Verify owner
            if (fromId.toString() !== process.env.OWNER_CHAT_ID && fromId !== ownerId) {
                console.log(`Ignored message from ${fromId}`);
                return;
            }

            if (text.trim().toLowerCase() === 'approve' || text.trim().toLowerCase() === 'ок' || text.trim().toLowerCase() === 'ok') {
                await this.handleApprove(ctx);
                return;
            }

            if (text.trim().toLowerCase() === 'decline' || text.trim().toLowerCase() === 'отмена') {
                await this.handleDecline(ctx);
                return;
            }

            // Delegate everything else to the AI Agent
            try {
                const response = await agentService.processMessage(text);
                await ctx.reply(response, { parse_mode: 'Markdown' });
            } catch (err: any) {
                console.error('Error processing message:', err);
                if (err?.code === 'insufficient_quota') {
                    await ctx.reply('⚠️ **Ошибка доступа к AI**: Закончились средства на балансе OpenAI API. Пожалуйста, пополните счет.');
                } else {
                    await ctx.reply('Произошла ошибка при обработке вашего запроса.');
                }
            }
        });

        this.bot.action(/^approve_topics_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const weekId = parseInt(ctx.match[1], 10);
            await this.handleApprove(ctx, weekId);
        });

        this.bot.action(/^decline_topics_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const weekId = parseInt(ctx.match[1], 10);
            await this.handleDecline(ctx, weekId);
        });

        this.bot.action(/^approve_post_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handlePostApprove(ctx, postId);
        });

        this.bot.action(/^regen_post_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handlePostRegen(ctx, postId);
        });

        this.bot.action(/^review_pending_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const weekId = parseInt(ctx.match[1], 10);
            await this.handleReviewPending(ctx, weekId);
        });
        this.bot.action(/^generate_image_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleGenerateImage(ctx, postId);
        });

        this.bot.action(/^approve_image_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleApproveImage(ctx, postId);
        });

        this.bot.action(/^regen_image_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleGenerateImage(ctx, postId); // Reuse generation logic
        });

        this.bot.action(/^skip_image_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handlePostApprove(ctx, postId, true); // True = skip image check
        });
    }

    private async handleTheme(ctx: Context, theme: string) {
        // 1. Get next week range
        const { start, end } = await plannerService.getNextWeekRange();

        const channelId = 1;

        const existingWeek = await plannerService.findWeekByDate(channelId, start);
        if (existingWeek) {
            // Force reset to allow re-trying with new theme
            await prisma.post.deleteMany({ where: { week_id: existingWeek.id } });
            await prisma.week.delete({ where: { id: existingWeek.id } });
        }

        const week = await plannerService.createWeek(channelId, theme, start, end);
        const weekId = week.id;
        await plannerService.generateSlots(weekId, channelId, start);

        await ctx.reply(`Принята тема: "${theme}". Генерирую темы постов...`);

        // 3. Generate Topics
        const topics = await generatorService.generateTopics(theme);
        await plannerService.saveTopics(weekId, topics);

        // 4. Send Review
        const response = topics.map((t, i) => `${(i + 1).toString().padStart(2, '0')}. ${t.topic} [${t.category}]`).join('\n');
        await ctx.reply(`Вот предложенные темы:\n\n${response}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ Ок', `approve_topics_${weekId}`)],
                [Markup.button.callback('🔄 Перегенерировать', `decline_topics_${weekId}`)]
            ])
        );
    }

    private async handleApprove(ctx: Context, weekId?: number) {
        let existingWeek;
        if (weekId) {
            existingWeek = await prisma.week.findUnique({
                where: { id: weekId },
                include: { posts: true }
            });
        } else {
            const { start } = await plannerService.getNextWeekRange();
            existingWeek = await plannerService.findWeekByDate(1, start);
        }

        if (!existingWeek || (existingWeek.status !== 'topics_generated' && existingWeek.status !== 'topics_approved')) {
            await ctx.reply('Нечего подтверждать (или статус уже изменился).');
            return;
        }

        await plannerService.updateWeekStatus(existingWeek.id, 'topics_approved');
        await ctx.reply('Темы утверждены! Начинаю генерацию длинных экспертных постов (14 штук). Это займет около 10 минут, я буду присылать их по мере готовности...');

        const posts = await plannerService.getWeekPosts(existingWeek.id);
        let count = 0;

        for (const post of posts) {
            try {
                if (!post.topic) continue;
                count++;
                console.log(`Generating post ${count}/14: ${post.topic}`);

                const text = await generatorService.generatePostText(existingWeek.theme, post.topic);

                await plannerService.updatePost(post.id, {
                    generated_text: text,
                    final_text: text,
                    status: 'generated'
                });

                const dateStr = format(new Date(post.publish_at), 'dd.MM HH:mm');
                let messageText = `📝 **Пост ${count}/14 на ${dateStr}**\nТема: ${post.topic}\nКатегория: ${post.category || 'N/A'}\nТеги: ${post.tags.join(', ')}\n\n${text}`;

                if (messageText.length > 4000) {
                    messageText = messageText.substring(0, 3990) + '... (текст обрезан для лимита Telegram)';
                }

                await ctx.reply(
                    messageText,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('👍 Утвердить текст', `approve_post_${post.id}`)],
                            [Markup.button.callback('🔄 Перегенерировать', `regen_post_${post.id}`)]
                        ])
                    }
                );

                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                console.error(`Error generating post ${post.id}:`, err);
                await ctx.reply(`Ошибка при генерации поста "${post.topic}". Пробую следующий...`);
            }
        }

        await ctx.reply('Генерация всех постов завершена!');
    }

    async handlePostApprove(ctx: Context, postId: number, skipImage = false) {
        const post = await plannerService.getPostById(postId);
        if (!post) return;

        // If not skipping image and no image yet, ask for image
        if (!skipImage && !post.image_url) {
            await ctx.editMessageReplyMarkup({
                inline_keyboard: [
                    [{ text: '🖼 Сгенерировать иллюстрацию', callback_data: `generate_image_${postId}` }],
                    [{ text: '🚫 Без картинки (В план)', callback_data: `skip_image_${postId}` }]
                ]
            });
            // @ts-ignore
            await ctx.reply('Текст утвержден! Хотите добавить иллюстрацию?', { reply_parameters: { message_id: ctx.callbackQuery?.message?.message_id } });
            return;
        }

        // Finalize post (Scheduled)
        await plannerService.updatePost(postId, { status: 'scheduled' });

        // Final confirmation message
        if (ctx.callbackQuery?.message) {
            const msgId = ctx.callbackQuery.message.message_id;
            // Try to edit the markup to remove buttons
            try {
                await ctx.telegram.editMessageReplyMarkup(ctx.chat?.id, msgId, undefined, { inline_keyboard: [] });
            } catch (e) { /* ignore */ }
        }

        // Check if it's already time to publish
        const now = new Date();
        if (new Date(post.publish_at) <= now) {
            await ctx.reply(`Пост ${postId} полностью готов и публикуется прямо сейчас! 🚀`);
            await publisherService.publishDuePosts();
        } else {
            await ctx.reply(`Пост ${postId} полностью готов и запланирован! ✅`);
        }
    }

    async handleGenerateImage(ctx: Context, postId: number) {
        await ctx.reply('🎨 Придумываю промпт и рисую... (это займет около 15-30 сек)');
        const post = await plannerService.getPostById(postId);
        if (!post || !post.generated_text || !post.topic) return;

        try {
            const prompt = await generatorService.generateImagePrompt(post.topic, post.generated_text);
            console.log(`Image Prompt for ${postId}:`, prompt);

            const imageUrl = await generatorService.generateImage(prompt);
            console.log(`Image Generated:`, imageUrl);

            // Save to DB
            await plannerService.updatePost(postId, { image_url: imageUrl });

            // Send preview
            await ctx.replyWithPhoto(imageUrl, {
                caption: `Иллюстрация к посту "${post.topic}"`,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👍 Утвердить картинку', `approve_image_${postId}`)],
                    [Markup.button.callback('🔄 Перерисовать', `regen_image_${postId}`)],
                    [Markup.button.callback('🚫 Отмена (без картинки)', `skip_image_${postId}`)]
                ])
            });

        } catch (e) {
            console.error('Image Gen Error:', e);
            await ctx.reply('Ошибка при генерации картинки. Попробуйте еще раз или пропустите.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 Попробовать снова', `regen_image_${postId}`)],
                    [Markup.button.callback('🚫 Без картинки', `skip_image_${postId}`)]
                ])
            );
        }
    }

    async handleApproveImage(ctx: Context, postId: number) {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // Remove buttons from image preview
        await ctx.reply('Картинка утверждена!');
        await this.handlePostApprove(ctx, postId, true); // Proceed to schedule
    }

    async handlePostRegen(ctx: Context, postId: number) {
        await ctx.reply(`Перегенерирую пост ${postId}...`);
        const post = await plannerService.getPostById(postId);
        if (!post || !post.week) return;

        const text = await generatorService.generatePostText(post.week.theme, post.topic || '');
        await plannerService.updatePost(postId, {
            generated_text: text,
            final_text: text,
            status: 'generated',
            image_url: null // Reset image on text regen
        });

        const dateStr = format(new Date(post.publish_at), 'dd.MM HH:mm');
        let messageText = `📝 **Пост на ${dateStr}**\nТема: ${post.topic}\n\n${text}`;

        if (messageText.length > 4000) {
            messageText = messageText.substring(0, 3990) + '... (текст обрезан для лимита Telegram)';
        }

        await ctx.reply(
            messageText,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👍 Утвердить текст', `approve_post_${post.id}`)],
                    [Markup.button.callback('🔄 Перегенерировать', `regen_post_${post.id}`)]
                ])
            }
        );
    }

    private async handleDecline(ctx: Context, weekId?: number) {
        let existingWeek;
        if (weekId) {
            existingWeek = await prisma.week.findUnique({
                where: { id: weekId }
            });
        } else {
            const { start } = await plannerService.getNextWeekRange();
            existingWeek = await plannerService.findWeekByDate(1, start);
        }

        if (!existingWeek || (existingWeek.status !== 'topics_generated' && existingWeek.status !== 'planning')) {
            await ctx.reply('Не найдена актуальная неделя для регенерации.');
            return;
        }

        if (existingWeek.regen_attempt >= 3) {
            await ctx.reply('Превышен лимит регенераций (3). Пожалуйста, введите темы вручную или свяжитесь с поддержкой.');
            return;
        }

        // Increment regen attempt
        await prisma.week.update({
            where: { id: existingWeek.id },
            data: { regen_attempt: { increment: 1 } }
        });

        await ctx.reply(`🔄 Генерирую новые темы (Попытка ${existingWeek.regen_attempt + 1}/3)...`);

        const topics = await generatorService.generateTopics(existingWeek.theme);
        await plannerService.saveTopics(existingWeek.id, topics);

        const response = topics.map((t, i) => `${i + 1}. ${t.topic}`).join('\n');
        await ctx.reply(`Вот НОВЫЕ предложенные темы:\n\n${response}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ Ок', `approve_topics_${existingWeek.id}`)],
                [Markup.button.callback('🔄 Перегенерировать', `decline_topics_${existingWeek.id}`)]
            ])
        );
    }

    private async handleReviewPending(ctx: Context, weekId: number) {
        const posts = await prisma.post.findMany({
            where: {
                week_id: weekId,
                status: 'generated'
            },
            orderBy: { topic_index: 'asc' }
        });

        if (posts.length === 0) {
            await ctx.reply('Нет постов, ожидающих утверждения.');
            return;
        }

        await ctx.reply(`Пересылаю посты для проверки (${posts.length} шт)...`);

        for (const post of posts) {
            try {
                const dateStr = format(new Date(post.publish_at), 'dd.MM HH:mm');
                let text = `📝 **Пост ${post.topic_index}/14 на ${dateStr}**\nТема: ${post.topic}\n\n${post.generated_text}`;

                if (text.length > 4000) {
                    text = text.substring(0, 3990) + '... (текст обрезан для лимита Telegram)';
                }

                await ctx.reply(
                    text,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('👍 Утвердить текст', `approve_post_${post.id}`)],
                            [Markup.button.callback('🔄 Перегенерировать', `regen_post_${post.id}`)]
                        ])
                    }
                );
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                console.error(`Failed to resend post ${post.id}:`, err);
                await ctx.reply(`Ошибка при пересылке поста ${post.topic_index}. Возможно, он слишком длинный.`);
            }
        }
    }

    private async sendWeekDetails(ctx: Context, weekId: number) {
        const week = await prisma.week.findUnique({
            where: { id: weekId },
            include: { posts: true }
        });
        if (!week) {
            await ctx.reply('План не найден.');
            return;
        }

        const sortedPosts = week.posts.sort((a: any, b: any) => a.topic_index - b.topic_index);
        const postsStatus = sortedPosts.map((p: any) => {
            const date = new Date(p.publish_at);
            const dateStr = format(date, 'dd.MM');
            const hour = date.getHours();
            const timeLabel = hour < 14 ? 'утро' : 'вечер';
            const num = p.topic_index.toString().padStart(2, '0');
            const hasImage = p.image_url ? '🖼' : '';
            return `${num}. [${dateStr} ${timeLabel}] ${p.status === 'scheduled' ? '✅' : '⏳'} ${p.topic || 'Без темы'} ${hasImage}`;
        }).join('\n');

        const weekRange = `${format(new Date(week.week_start), 'dd.MM')} — ${format(new Date(week.week_end), 'dd.MM')}`;

        const buttons = [];
        if (week.status === 'topics_generated' || week.status === 'planning' || week.status === 'topics_approved') {
            buttons.push([Markup.button.callback('✅ Утвердить и генерировать посты', `approve_topics_${week.id}`)]);
            buttons.push([Markup.button.callback('🔄 Перегенерировать темы', `decline_topics_${week.id}`)]);
        }

        const pendingCount = week.posts.filter((p: any) => p.status === 'generated').length;
        if (pendingCount > 0) {
            buttons.push([Markup.button.callback(`👀 Проверить посты (${pendingCount} шт)`, `review_pending_${week.id}`)]);
        }

        await ctx.reply(
            `📅 **Неделя: ${weekRange}**\nТема: ${week.theme}\nСтатус: ${week.status}\n\nПосты:\n${postsStatus || 'Нет постов'}`,
            buttons.length > 0 ? Markup.inlineKeyboard(buttons) : undefined
        );
    }

    async launch() {
        if (process.env.DOMAIN) {
            this.isWebhook = true;
            const secretPath = `/telegram/webhook`;
            await this.bot.telegram.setWebhook(`${process.env.DOMAIN}${secretPath}`);
            console.log(`Webhook set to ${process.env.DOMAIN}${secretPath}`);
        } else {
            console.log('Starting via polling...');
            this.bot.launch();
        }
    }

    async sendMessage(chatId: string | number, text: string, extra?: any) {
        return this.bot.telegram.sendMessage(chatId, text, extra);
    }

    async sendPhoto(chatId: string | number, photo: string, extra?: any) {
        return this.bot.telegram.sendPhoto(chatId, photo, extra);
    }

    async handleUpdate(update: any) {
        return this.bot.handleUpdate(update);
    }
}

const telegramService = new TelegramService();
export default telegramService;
