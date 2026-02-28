import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class V2OrchestratorService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    private async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
        const completion = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            response_format: { type: "json_object" }
        });

        return completion.choices[0]?.message.content || '{}';
    }

    /**
     * Strategic Media Orchestrator (SMO)
     * Generates a WeekPackage strategy
     */
    async planWeek(projectId: number, weekStart: Date, weekEnd: Date, themeHint: string = "") {
        console.log(`[SMO] Planning week for project ${projectId}`);

        // Fetch known FAE preferences
        const prefs = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'fae_strategy_preferences' } }
        });
        const strategyShifts = prefs ? prefs.value : 'Предпочтений или замечаний от автора пока нет.';

        const systemPrompt = `Ты — Strategic Media Orchestrator (SMO). Строгий стратег и контент-директор IT-канала.
Твоя задача: Разработать стратегический 'Weekly Package' (комплексный недельный план) для аудитории уровня от новичков до сеньоров. 
Мы не пишем учебники, мы вскрываем проблемы, строим мосты между техникой и бизнесом.

Внимание, новые стратегические корректировки от автора (Feedback):
${strategyShifts}

Заполни и верни строго JSON объект с полями:
- week_theme: строка
- core_thesis: строка (1-2 предложения, главная мысль недели)
- audience_focus: строка (например, 'Beginner+Pro mix')
- intent_tag: строка (Awareness / Authority / Warmup / Launch / Maintenance)
- monetization_tie: строка (none / hint / intensive / product_name)
- narrative_arc: массив из 7 строк, описывающих логику развития мысли с Пн по Вс (Hook -> Problem -> Cases -> Solutions -> Feedback etc)
- risks: массив строк (чего избегать на этой неделе: 'too complex', 'oversimplification', 'repetition')
`;

        const userPrompt = `Создай план на неделю с ${weekStart.toISOString().split('T')[0]} по ${weekEnd.toISOString().split('T')[0]}.
Направление/пожелание от владельца: ${themeHint ? themeHint : 'На твое усмотрение, упор на системный анализ'}`;

        const resultStr = await this.callLLM(systemPrompt, userPrompt);
        const parsed = JSON.parse(resultStr);

        return await prisma.weekPackage.create({
            data: {
                project_id: projectId,
                week_start: weekStart,
                week_end: weekEnd,
                week_theme: parsed.week_theme,
                core_thesis: parsed.core_thesis,
                audience_focus: parsed.audience_focus,
                intent_tag: parsed.intent_tag,
                monetization_tie: parsed.monetization_tie,
                narrative_arc: parsed.narrative_arc,
                risks: parsed.risks,
                approval_status: 'draft'
            }
        });
    }

    /**
     * Distribution Architect (DA)
     * Breaks down the WeekPackage into ContentItems across channels and layers
     */
    async architectDistribution(weekPackageId: number, channelsSpec: any) {
        console.log(`[DA] Architecting distribution for week package ${weekPackageId}`);

        const wp = await prisma.weekPackage.findUnique({ where: { id: weekPackageId } });
        if (!wp) throw new Error("WeekPackage not found");

        const systemPrompt = `Ты — Distribution Architect (DA).
Твоя задача — разложить стратегию 'Week Package' на конкретные единицы контента (Content Items).
Обязательно соблюдай запрошенную квоту по каналам и форматам, используя правильные 'layers' (азбука, аналитик, pro, community).

Верни JSON:
{
  "items": [
    {
      "type": "tg_post | vk_post | habr_article | vc_article | zen_article | video_script",
      "target_channel_id": number (or null for generic articles/videos),
      "layer": "azbuka | analyst | pro | community | expert",
      "day_offset": number (0-6),
      "title": "string",
      "brief": "string (1-3 paragraphs of what to write)",
      "key_points": ["string", "string", ...],
      "cta": "string (optional)"
    }
  ],
  "cross_links_strategy": ["string", "string"]
}`;

        const userPrompt = `Week Strategy:
Theme: ${wp.week_theme}
Thesis: ${wp.core_thesis}
Intent: ${wp.intent_tag}
Narrative Arc: ${JSON.stringify(wp.narrative_arc)}

Requirements (Channels/Specs):
${JSON.stringify(channelsSpec, null, 2)}

Распредели контент логично по дням недели (day_offset 0-6), чтобы поддержать Narrative Arc.`;

        const resultStr = await this.callLLM(systemPrompt, userPrompt);

        let parsed: any = { items: [], cross_links_strategy: [] };
        try {
            parsed = JSON.parse(resultStr);
        } catch (e) {
            console.error("Failed to parse DA output", resultStr);
        }

        const createdItems = [];
        for (const item of parsed.items) {
            const scheduleDate = new Date(wp.week_start);
            scheduleDate.setDate(scheduleDate.getDate() + (item.day_offset || 0));
            // Default time 12:00 UTC
            scheduleDate.setUTCHours(12, 0, 0, 0);

            const tId = parseInt(item.target_channel_id, 10);
            const validChannelId = !isNaN(tId) && tId > 0 ? tId : undefined;

            const dbItem = await prisma.contentItem.create({
                data: {
                    project_id: wp.project_id,
                    week_package_id: wp.id,
                    channel_id: validChannelId,
                    type: item.type,
                    layer: item.layer,
                    title: item.title,
                    brief: item.brief,
                    key_points: item.key_points,
                    cta: item.cta,
                    status: 'planned',
                    schedule_at: scheduleDate
                }
            });
            createdItems.push(dbItem);
        }

        await prisma.weekPackage.update({
            where: { id: wp.id },
            data: { cross_links: parsed.cross_links_strategy }
        });

        return createdItems;
    }

    /**
     * Narrative Continuity Controller (NCC)
     * Validates the sequence
     */
    async validateContinuity(weekPackageId: number) {
        console.log(`[NCC] Validating continuity for week package ${weekPackageId}`);
        // For MVP, we'll just pull the data, ask NCC to review, and store its report.
        const wp = await prisma.weekPackage.findUnique({
            where: { id: weekPackageId },
            include: { content_items: { orderBy: { schedule_at: 'asc' } } }
        });

        if (!wp) throw new Error("WeekPackage not found");

        const systemPrompt = `Ты — Narrative Continuity Controller (NCC).
Твоя задача — проверить последовательность единиц контента в неделе.
1. Идет ли повествование от общего к частному/сложному?
2. Нет ли дублирования тем?
3. Отрабатывает ли контент заявленную арку (hook -> value -> etc)?
4. Выполнены ли кросс-ссылки на крупные статьи/видео из соцсетей?

Верни JSON:
{
   "valid": boolean,
   "critique": "Подробный разбор (в чем проблема или почему хорошо)",
   "suggestions": ["что исправить", "что добавить"]
}`;

        const userPrompt = `Week Package: ${JSON.stringify(wp, null, 2)}`;

        const resultStr = await this.callLLM(systemPrompt, userPrompt);
        const report = JSON.parse(resultStr);

        if (!report.valid) {
            await prisma.weekPackage.update({
                where: { id: wp.id },
                data: { approval_status: 'needs_review', risks: report.suggestions } // merge/replace
            });
        } else {
            // Keep draft, allow owner to review
        }

        return report;
    }
}

export default new V2OrchestratorService();
