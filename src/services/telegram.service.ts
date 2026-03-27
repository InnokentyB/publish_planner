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
import multiAgentService from './multi_agent.service';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class TelegramService {
    public bot: Telegraf;
    private isWebhook = false;
    private promptEditState: Map<number, string> = new Map(); // userId -> promptKey being edited

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

    private async getProjectId(ctx: Context): Promise<number | null> {
        if (!ctx.chat) return 1; // Fallback to project 1 for global bots

        // Try to find a channel that matches this chat id
        const channel = await prisma.socialChannel.findFirst({
            where: {
                type: 'telegram',
                config: {
                    path: ['telegram_channel_id'],
                    equals: ctx.chat.id.toString()
                }
            }
        });

        return channel ? channel.project_id : 1;
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

        this.bot.command('image_prompt', async (ctx) => {
            const projectId = await this.getProjectId(ctx);
            if (!projectId) return;
            // Alias for DALL-E
            const prompt = await generatorService.getImagePromptTemplate(projectId, 'dalle');
            await ctx.reply(`🎨 **Текущий промпт для DALL-E:**\n\n\`${prompt}\``, { parse_mode: 'Markdown' });
            await ctx.reply('Чтобы изменить, используй: `/set_prompt_dalle ...`');
        });

        this.bot.command('prompt_dalle', async (ctx) => {
            const projectId = await this.getProjectId(ctx);
            if (!projectId) return;
            const prompt = await generatorService.getImagePromptTemplate(projectId, 'dalle');
            await ctx.reply(`🎨 **Текущий промпт для DALL-E:**\n\n\`${prompt}\``, { parse_mode: 'Markdown' });
        });

        this.bot.command('prompt_nano', async (ctx) => {
            const projectId = await this.getProjectId(ctx);
            if (!projectId) return;
            const prompt = await generatorService.getImagePromptTemplate(projectId, 'nano');
            await ctx.reply(`🍌 **Текущий промпт для Nano Banana:**\n\n\`${prompt}\``, { parse_mode: 'Markdown' });
        });

        this.bot.command('set_image_prompt', async (ctx) => {
            const projectId = await this.getProjectId(ctx);
            if (!projectId) return;
            // Legacy alias
            // @ts-ignore
            const newPrompt = ctx.message.text.replace('/set_image_prompt', '').trim();
            if (!newPrompt) {
                await ctx.reply('Укажите промпт.');
                return;
            }
            await generatorService.updateImagePromptTemplate(projectId, newPrompt, 'dalle');
            await ctx.reply('✅ Промпт для DALL-E обновлен!');
        });

        this.bot.command('set_prompt_dalle', async (ctx) => {
            const projectId = await this.getProjectId(ctx);
            if (!projectId) return;
            // @ts-ignore
            const newPrompt = ctx.message.text.replace('/set_prompt_dalle', '').trim();
            if (!newPrompt) {
                await ctx.reply('Пожалуйста, укажите текст промпта после команды.', { parse_mode: 'Markdown' });
                return;
            }

            await generatorService.updateImagePromptTemplate(projectId, newPrompt, 'dalle');
            await ctx.reply('✅ Промпт для DALL-E обновлен!');
        });

        this.bot.command('set_prompt_nano', async (ctx) => {
            const projectId = await this.getProjectId(ctx);
            if (!projectId) return;
            // @ts-ignore
            const newPrompt = ctx.message.text.replace('/set_prompt_nano', '').trim();
            if (!newPrompt) {
                await ctx.reply('Пожалуйста, укажите текст промпта после команды.', { parse_mode: 'Markdown' });
                return;
            }

            await generatorService.updateImagePromptTemplate(projectId, newPrompt, 'nano');
            await ctx.reply('✅ Промпт для Nano Banana обновлен!');
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


        // --- Prompt Management ---

        this.bot.command('edit_prompts', async (ctx) => {
            await ctx.reply('Выберите категорию агентов:',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📑 Агенты Тем (Topic Agents)', 'menu_topic_agents')],
                    [Markup.button.callback('✍️ Агенты Постов (Post Agents)', 'menu_post_agents')]
                ])
            );
        });

        // --- Topic Agents Menu ---
        this.bot.action('menu_topic_agents', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.editMessageText('Агенты генерации тем (Topic Agents):',
                Markup.inlineKeyboard([
                    [Markup.button.callback('Idea Creator', `view_prompt_${multiAgentService.KEY_TOPIC_CREATOR}`)],
                    [Markup.button.callback('Critic', `view_prompt_${multiAgentService.KEY_TOPIC_CRITIC}`)],
                    [Markup.button.callback('Fixer', `view_prompt_${multiAgentService.KEY_TOPIC_FIXER}`)],
                    [Markup.button.callback('🔙 Назад', 'back_to_main_prompts')]
                ])
            );
        });

        // --- Post Agents Menu ---
        this.bot.action('menu_post_agents', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.editMessageText('Агенты генерации постов (Post Agents):',
                Markup.inlineKeyboard([
                    [Markup.button.callback('Post Creator', `config_agent_post_creator`)],
                    [Markup.button.callback('Post Critic', `config_agent_post_critic`)],
                    [Markup.button.callback('Post Fixer', `config_agent_post_fixer`)],
                    [Markup.button.callback('🔙 Назад', 'back_to_main_prompts')]
                ])
            );
        });

        this.bot.action('back_to_main_prompts', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.editMessageText('Выберите категорию агентов:',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📑 Агенты Тем (Topic Agents)', 'menu_topic_agents')],
                    [Markup.button.callback('✍️ Агенты Постов (Post Agents)', 'menu_post_agents')]
                ])
            );
        });

        // --- Config Agent Menu (Post Agents) ---
        this.bot.action(/^config_agent_(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const agentRole = ctx.match[1]; // post_creator, post_critic, post_fixer

            let roleName = '';
            let keyPrompt = '', keyApiKey = '', keyModel = '';

            if (agentRole === 'post_creator') {
                roleName = 'Post Creator';
                keyPrompt = multiAgentService.KEY_POST_CREATOR_PROMPT;
                keyApiKey = multiAgentService.KEY_POST_CREATOR_KEY;
                keyModel = multiAgentService.KEY_POST_CREATOR_MODEL;
            } else if (agentRole === 'post_critic') {
                roleName = 'Post Critic';
                keyPrompt = multiAgentService.KEY_POST_CRITIC_PROMPT;
                keyApiKey = multiAgentService.KEY_POST_CRITIC_KEY;
                keyModel = multiAgentService.KEY_POST_CRITIC_MODEL;
            } else if (agentRole === 'post_fixer') {
                roleName = 'Post Fixer';
                keyPrompt = multiAgentService.KEY_POST_FIXER_PROMPT;
                keyApiKey = multiAgentService.KEY_POST_FIXER_KEY;
                keyModel = multiAgentService.KEY_POST_FIXER_MODEL;
            }

            await ctx.editMessageText(`Настройка агента **${roleName}**:`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📝 Системный Промпт', `view_prompt_${keyPrompt}`)],
                        [Markup.button.callback('🔑 API Key', `view_prompt_${keyApiKey}`)],
                        [Markup.button.callback('🤖 Model Name', `view_prompt_${keyModel}`)],
                        [Markup.button.callback('🔙 Назад к списку', 'menu_post_agents')]
                    ])
                }
            );
        });

        this.bot.action(/^view_prompt_(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const key = ctx.match[1];

            // We need a way to get the current prompt. 
            // Since `getPrompt` is private in MultiAgentService, we might need to expose a getter 
            // OR use prisma directly here. Let's use Prisma directly to avoid changing service interface if possible, 
            // OR better, add a public getter to MultiAgentService. 
            // For now, I'll access Prisma via existing reference in this file.

            const setting = await prisma.promptSettings.findUnique({ where: { key } });
            const value = setting?.value || 'Is not set (using default)';

            await ctx.reply(`📜 **Текущий промпт (${key}):**\n\n\`${value}\``,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✏️ Редактировать', `edit_prompt_${key}`)],
                        [Markup.button.callback('🔙 Назад', `back_to_prompts`)]
                    ])
                }
            );
        });

        this.bot.action('back_to_prompts', async (ctx) => {
            await ctx.answerCbQuery();
            // Detect which menu to go back to based on context or just go to main topic menu (legacy behavior)
            // But we have a new structure. Let's redirect to Topic Agents menu for legacy calls
            await ctx.editMessageText('Агенты генерации тем (Topic Agents):',
                Markup.inlineKeyboard([
                    [Markup.button.callback('Idea Creator', `view_prompt_${multiAgentService.KEY_TOPIC_CREATOR}`)],
                    [Markup.button.callback('Critic', `view_prompt_${multiAgentService.KEY_TOPIC_CRITIC}`)],
                    [Markup.button.callback('Fixer', `view_prompt_${multiAgentService.KEY_TOPIC_FIXER}`)],
                    [Markup.button.callback('🔙 Назад', 'back_to_main_prompts')]
                ])
            );
        });

        this.bot.action(/^edit_prompt_(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const key = ctx.match[1];
            // @ts-ignore
            const userId = ctx.from.id;

            this.promptEditState.set(userId, key);

            await ctx.reply(`Введите новый текст для промпта **${key}**.\n\nОтправьте текст одним сообщением.`, { parse_mode: 'Markdown' });
        });

        this.bot.on('text', async (ctx: Context) => {
            console.log('Received text:', ctx.message);
            // @ts-ignore
            const text = ctx.message.text;
            // @ts-ignore
            const fromId = ctx.from.id;
            const ownerId = parseInt(process.env.OWNER_CHAT_ID || '0', 10);

            // Check if editing prompt
            if (this.promptEditState.has(fromId)) {
                const key = this.promptEditState.get(fromId)!;
                // Update prompt
                await prisma.promptSettings.upsert({
                    where: { key: key },
                    update: { value: text },
                    create: { key: key, value: text }
                });

                this.promptEditState.delete(fromId);
                await ctx.reply(`✅ Промпт **${key}** успешно обновлен!`, { parse_mode: 'Markdown' });
                return;
            }

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
        this.bot.action(/^gen_img_dalle_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleGenerateImage(ctx, postId, 'dalle');
        });

        this.bot.action(/^gen_img_nano_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleGenerateImage(ctx, postId, 'nano');
        });

        this.bot.action(/^gen_img_full_chain_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleFullImagePipeline(ctx, postId);
        });

        this.bot.action(/^approve_image_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleApproveImage(ctx, postId);
        });

        this.bot.action(/^regen_image_(\d+)$/, async (ctx) => {
            // Legacy support
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handleGenerateImage(ctx, postId, 'dalle');
        });

        this.bot.action(/^skip_image_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            // @ts-ignore
            const postId = parseInt(ctx.match[1], 10);
            await this.handlePostApprove(ctx, postId, true); // True = skip image check
        });

        // --- Prompt Management ---



    }

    private async handleTheme(ctx: Context, theme: string) {
        const projectId = await this.getProjectId(ctx) || 1;
        // 1. Get next week range
        const { start, end } = await plannerService.getNextWeekRange();

        const existingWeek = await plannerService.findWeekByDate(projectId, start);
        if (existingWeek) {
            // Force reset to allow re-trying with new theme
            await prisma.post.deleteMany({ where: { week_id: existingWeek.id } });
            await prisma.week.delete({ where: { id: existingWeek.id } });
        }

        const week = await plannerService.createWeek(projectId, theme, start, end);
        const weekId = week.id;
        await plannerService.generateSlots(weekId, projectId, start);

        await ctx.reply(`Принята тема: "${theme}". Генерирую темы постов...`);

        // 3. Generate Topics
        const { topics, score } = await generatorService.generateTopics(projectId, theme, weekId);
        await plannerService.saveTopics(weekId, topics);

        // 4. Send Review
        const response = topics.map((t, i) => `${(i + 1).toString().padStart(2, '0')}. ${t.topic} [${t.category}]`).join('\n');
        await ctx.reply(`Вот предложенные темы (Оценка качества: ${score}/100):\n\n${response}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ Ок', `approve_topics_${weekId}`)],
                [Markup.button.callback('🔄 Перегенерировать', `decline_topics_${weekId}`)]
            ])
        );
    }

    private async handleApprove(ctx: Context, weekId?: number) {
        const projectId = await this.getProjectId(ctx) || 1;
        let existingWeek;
        if (weekId) {
            existingWeek = await prisma.week.findUnique({
                where: { id: weekId, project_id: projectId },
                include: { posts: true }
            });
        } else {
            const { start } = await plannerService.getNextWeekRange();
            existingWeek = await plannerService.findWeekByDate(projectId, start);
        }

        if (!existingWeek || (existingWeek.status !== 'topics_generated' && existingWeek.status !== 'topics_approved')) {
            await ctx.reply('Нечего подтверждать (или статус уже изменился).');
            return;
        }

        await plannerService.updateWeekStatus(existingWeek.id, 'topics_approved');
        await ctx.reply('Темы утверждены! Начинаю генерацию длинных экспертных постов (2 штуки). Это займет несколько минут, я буду присылать их по мере готовности...');

        const posts = await plannerService.getWeekPosts(existingWeek.id);
        let count = 0;

        for (const post of posts) {
            try {
                if (!post.topic) continue;
                count++;
                console.log(`Generating post ${count}/2: ${post.topic}`);

                const result = await generatorService.generatePostText(projectId, existingWeek.theme, post.topic, post.id);

                // Construct full text with hashtags
                // Strip any leading # from AI-returned tags to avoid ## double-prefix
                let fullText = result.text;
                if (result.tags && result.tags.length > 0) {
                    fullText += '\n\n' + result.tags.map(t => `#${t.replace(/\s+/g, '').replace(/^#+/, '')}`).join(' ');
                } else if (result.category) {
                    fullText += `\n\n#${result.category.replace(/\s+/g, '').replace(/^#+/, '')}`;
                }

                await plannerService.updatePost(post.id, {
                    generated_text: fullText,
                    final_text: fullText,
                    status: 'generated',
                    category: result.category || undefined,
                    tags: result.tags || undefined
                });

                // Update local post object for message display
                post.category = result.category || null;
                post.tags = result.tags || [];

                const dateStr = format(new Date(post.publish_at), 'dd.MM HH:mm');
                let messageText = `📝 **Пост ${count}/2 на ${dateStr}**\nТема: ${post.topic}\nКатегория: ${post.category || 'N/A'}\nТеги: ${post.tags.join(', ')}\n\n${fullText}`;

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
                    [
                        { text: '🎨 DALL-E', callback_data: `gen_img_dalle_${postId}` },
                        { text: '🍌 Nano Banana', callback_data: `gen_img_nano_${postId}` }
                    ],
                    [
                        { text: '🧠 DALL-E -> Critic -> Nano', callback_data: `gen_img_full_chain_${postId}` }
                    ],
                    [{ text: '🚫 Без картинки (В план)', callback_data: `skip_image_${postId}` }]
                ]
            });
            // @ts-ignore
            await ctx.reply('Текст утвержден! Выберите нейросеть для иллюстрации:', { reply_parameters: { message_id: ctx.callbackQuery?.message?.message_id } });
            return;
        }

        // Finalize post (Scheduled Internal)
        await plannerService.updatePost(postId, { status: 'scheduled' });

        // Delete the preview message
        if (ctx.callbackQuery?.message) {
            try {
                await ctx.deleteMessage();
            } catch (e) { /* ignore */ }
        }

        const now = new Date();
        if (new Date(post.publish_at) <= now) {
            // Send immediately
            await publisherService.publishPostNow(post.id);
            await ctx.reply(`Пост ${postId} опубликован прямо сейчас! 🚀`);
        } else {
            // Internal Schedule
            const dateStr = format(new Date(post.publish_at), 'dd.MM HH:mm');
            await ctx.reply(`Пост ${postId} запланирован на ${dateStr} (внутренний планировщик). ✅\nОн будет опубликован автоматически в назначенное время.`);
        }
    }

    async handleGenerateImage(ctx: Context, postId: number, provider: 'dalle' | 'nano') {
        const projectId = await this.getProjectId(ctx) || 1;
        try {
            await ctx.deleteMessage();
        } catch (e) { }

        const providerName = provider === 'nano' ? 'Nano Banana' : 'DALL-E';
        const loadingMsg = await ctx.reply(`🎨 (${providerName}) Придумываю промпт и рисую... (это займет около 15-30 сек)`);

        const post = await prisma.post.findUnique({
            where: { id: postId, project_id: projectId }
        });
        if (!post || !post.generated_text || !post.topic) {
            try { await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMsg.message_id); } catch (e) { }
            return;
        }

        try {
            if (provider === 'nano' && !process.env.GOOGLE_API_KEY) {
                throw new Error('GOOGLE_API_KEY is not configured for Nano Banana.');
            }

            const prompt = await multiAgentService.runImagePromptingChain(projectId, post.generated_text, post.topic);
            console.log(`Image Prompt for ${postId} (${provider}) via Chain:`, prompt);

            // Show prompt to user
            await ctx.reply(`📝 **Генерация промпта (${providerName}):**\n\n\`${prompt}\`\n\n⏳ Начинаю рисовать...`, { parse_mode: 'Markdown' });

            let imageUrl = '';
            if (provider === 'nano') {
                imageUrl = await generatorService.generateImageNanoBanana(prompt);
            } else {
                imageUrl = await generatorService.generateImage(prompt);
            }

            console.log(`Image Generated:`, imageUrl);

            // Save to DB
            await plannerService.updatePost(postId, { image_url: imageUrl });

            // Delete loading message
            try { await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMsg.message_id); } catch (e) { }

            // Send preview
            let photoSource: any = imageUrl;
            if (imageUrl.startsWith('data:')) {
                // Extract base64
                const base64Data = imageUrl.split(',')[1];
                photoSource = { source: Buffer.from(base64Data, 'base64') };
            }

            await ctx.replyWithPhoto(photoSource, {
                caption: `Иллюстрация к посту "${post.topic}" (${providerName})`,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👍 Утвердить картинку', `approve_image_${postId}`)],
                    [Markup.button.callback('🧠 DALL-E -> Critic -> Nano', `gen_img_full_chain_${postId}`)],
                    [Markup.button.callback('🔄 Перерисовать (DALL-E)', `gen_img_dalle_${postId}`)],
                    [Markup.button.callback('🔄 Перерисовать (Nano)', `gen_img_nano_${postId}`)],
                    [Markup.button.callback('🚫 Отмена (без картинки)', `skip_image_${postId}`)]
                ])
            });

        } catch (e: any) {
            console.error('Image Gen Error:', e);
            try { await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMsg.message_id); } catch (error) { }

            await ctx.reply(`Ошибка при генерации картинки (${providerName}): ${e.message}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 DALL-E', `gen_img_dalle_${postId}`)],
                    [Markup.button.callback('🔄 Nano Banana', `gen_img_nano_${postId}`)],
                    [Markup.button.callback('🧠 Полный цикл (Критик)', `gen_img_full_chain_${postId}`)],
                    [Markup.button.callback('🚫 Без картинки', `skip_image_${postId}`)]
                ])
            );
        }
    }

    async handleFullImagePipeline(ctx: Context, postId: number) {
        const projectId = await this.getProjectId(ctx) || 1;
        try {
            await ctx.deleteMessage();
        } catch (e) { }

        let loadingMsg: any = await ctx.reply(`🧠 (Этап 1/3) Анализирую тему и генерирую базовую картинку в DALL-E...`);

        const post = await prisma.post.findUnique({
            where: { id: postId, project_id: projectId }
        });
        if (!post || !post.generated_text || !post.topic) {
            try { await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMsg.message_id); } catch (e) { }
            return;
        }

        try {
            if (!process.env.GOOGLE_API_KEY) {
                throw new Error('GOOGLE_API_KEY is not configured for Nano Banana.');
            }

            // Step 1: Base prompt from Visual Architect chain and generate in DALL-E
            const initialPrompt = await multiAgentService.runImagePromptingChain(projectId, post.generated_text, post.topic);
            const dalleUrl = await generatorService.generateImage(initialPrompt);

            // Show interim DALL-E result
            try { await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMsg.message_id); } catch (e) { }
            loadingMsg = await ctx.replyWithPhoto(dalleUrl, {
                caption: `🧠 (Этап 2/3) DALL-E завершил черновик. Критик анализирует его...`
            });

            // Step 2: Critic analyzes the image
            const criticResult = await multiAgentService.runImageCritic(projectId, post.generated_text, dalleUrl);
            if (!criticResult) throw new Error("Critic failed to generate feedback.");

            const newPromptToUse = criticResult.new_prompt || (criticResult as any).prompt || `A highly detailed image about: ${post.topic}`;

            const feedbackMsg = `📝 **Анализ Критика:**\n\n**Оценка:** ${criticResult.critique || 'N/A'}\n\n**Рекомендации:** ${criticResult.recommendations || 'N/A'}\n\n**Новый промпт:** \`${newPromptToUse}\``;
            await ctx.reply(feedbackMsg, { parse_mode: 'Markdown' });

            try { await ctx.telegram.editMessageCaption(ctx.chat?.id!, loadingMsg.message_id, undefined, '🧠 (Этап 3/3) Nano Banana генерирует финальную версию...'); } catch (e) { }

            // Step 3: Nano Banana generates with reference and new prompt
            if (!newPromptToUse || newPromptToUse.trim() === '') throw new Error("Prompt generation failed, resulting string was empty.");
            const nanoUrl = await generatorService.generateImageNanoBanana(newPromptToUse, dalleUrl);

            // Fetch the image to send if it's a data URI
            let photoSource: any = nanoUrl;
            if (nanoUrl.startsWith('data:')) {
                const base64Data = nanoUrl.split(',')[1];
                photoSource = { source: Buffer.from(base64Data, 'base64') };
            }

            // Save final to DB
            await plannerService.updatePost(postId, { image_url: nanoUrl });

            // Send final result
            await ctx.replyWithPhoto(photoSource, {
                caption: `✅ Иллюстрация к посту "${post.topic}" после критики (Nano Banana)`,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👍 Утвердить картинку', `approve_image_${postId}`)],
                    [Markup.button.callback('🧠 Повторить весь цикл', `gen_img_full_chain_${postId}`)],
                    [Markup.button.callback('🔄 Перерисовать (DALL-E)', `gen_img_dalle_${postId}`)],
                    [Markup.button.callback('🔄 Перерисовать (Nano)', `gen_img_nano_${postId}`)],
                    [Markup.button.callback('🚫 Отмена (без картинки)', `skip_image_${postId}`)]
                ])
            });

        } catch (e: any) {
            console.error('Image Gen Full Pipeline Error:', e);
            try { await ctx.reply(`Ошибка полного цикла: ${e.message}`); } catch (error) { }

            await ctx.reply(`Что будем делать дальше?`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🧠 Повторить', `gen_img_full_chain_${postId}`)],
                    [Markup.button.callback('🎨 Сгенерировать DALL-E', `gen_img_dalle_${postId}`)],
                    [Markup.button.callback('🍌 Сгенерировать Nano', `gen_img_nano_${postId}`)],
                    [Markup.button.callback('🚫 Без картинки', `skip_image_${postId}`)]
                ])
            );
        }
    }

    async handleApproveImage(ctx: Context, postId: number) {
        await this.handlePostApprove(ctx, postId, true); // Proceed to schedule
    }

    async handlePostRegen(ctx: Context, postId: number) {
        const projectId = await this.getProjectId(ctx) || 1;
        await ctx.reply(`Перегенерирую пост ${postId}...`);
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { week: true }
        });
        if (!post || !post.week) return;

        const result = await generatorService.generatePostText(projectId, post.week.theme, post.topic || '', post.id);

        // Construct full text with hashtags
        // Strip any leading # from AI-returned tags to avoid ## double-prefix
        let fullText = result.text;
        if (result.tags && result.tags.length > 0) {
            fullText += '\n\n' + result.tags.map(t => `#${t.replace(/\s+/g, '').replace(/^#+/, '')}`).join(' ');
        } else if (result.category) {
            fullText += `\n\n#${result.category.replace(/\s+/g, '').replace(/^#+/, '')}`;
        }

        await plannerService.updatePost(postId, {
            generated_text: fullText,
            final_text: fullText,
            status: 'generated',
            category: result.category || undefined,
            tags: result.tags || undefined,
            image_url: null // Reset image on text regen
        });

        // Update local variables for message display
        post.category = result.category || null;
        post.tags = result.tags || [];
        const text = fullText;

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
        const projectId = await this.getProjectId(ctx) || 1;
        let existingWeek;
        if (weekId) {
            existingWeek = await prisma.week.findUnique({
                where: { id: weekId, project_id: projectId }
            });
        } else {
            const { start } = await plannerService.getNextWeekRange();
            existingWeek = await plannerService.findWeekByDate(projectId, start);
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

        const { topics, score } = await generatorService.generateTopics(projectId, existingWeek.theme, existingWeek.id);
        await plannerService.saveTopics(existingWeek.id, topics);

        const response = topics.map((t, i) => `${i + 1}. ${t.topic}`).join('\n');
        await ctx.reply(`Вот НОВЫЕ предложенные темы (Оценка качества: ${score}/100):\n\n${response}`,
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
                let text = `📝 **Пост ${post.topic_index}/2 на ${dateStr}**\nТема: ${post.topic}\n\n${post.generated_text}`;

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
        console.log(`[TelegramService] Sending Message to ${chatId}. Extra:`, JSON.stringify(extra));
        return this.bot.telegram.sendMessage(chatId, text, extra);
    }

    async sendPhoto(chatId: string | number, photo: string | { source: Buffer }, extra?: any) {
        // Truncate binary data from logging if possible, or just log extra
        console.log(`[TelegramService] Sending Photo to ${chatId}. Extra:`, JSON.stringify(extra));
        return this.bot.telegram.sendPhoto(chatId, photo, extra);
    }

    async scheduleMessage(chatId: string | number, text: string, timestamp: number, extra: any = {}) {
        console.log(`[TelegramService] Scheduling Message to ${chatId} at ${timestamp}`);
        return this.bot.telegram.callApi('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: extra.parse_mode,
            schedule_date: timestamp,
            ...extra
        });
    }

    async schedulePhoto(chatId: string | number, photo: string | { source: Buffer }, timestamp: number, extra: any = {}) {
        console.log(`[TelegramService] Scheduling Photo to ${chatId} at ${timestamp}`);

        if (typeof photo === 'string') {
            // Use callApi directly for URLs/FileIDs to ensure scheduling params are passed correctly
            return this.bot.telegram.callApi('sendPhoto', {
                chat_id: chatId,
                photo: photo,
                caption: extra.caption,
                parse_mode: extra.parse_mode,
                schedule_date: timestamp,
                ...extra
            });
        } else {
            // For Buffers, rely on Telegraf's sendPhoto but ensure schedule_date is in extra
            return this.bot.telegram.sendPhoto(chatId, photo, {
                ...extra,
                schedule_date: timestamp
            });
        }
    }

    async handleUpdate(update: any) {
        return this.bot.handleUpdate(update);
    }
}

export default new TelegramService();
