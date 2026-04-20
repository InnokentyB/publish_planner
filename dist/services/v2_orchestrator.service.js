"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.V2OrchestratorService = void 0;
const openai_1 = __importDefault(require("openai"));
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class V2OrchestratorService {
    constructor() {
        this.openai = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    async callLLM(systemPrompt, userPrompt) {
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
     * Quarter Strategic Planner (QSP)
     * Generates a QuarterPlan and 3 MonthArcs
     */
    async planQuarter(projectId, quarterStart, goalHint = "", plannedChannels) {
        console.log(`[QSP] Planning quarter for project ${projectId} starting ${quarterStart.toISOString()}`);
        // Fetch known FAE preferences
        const prefs = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'fae_strategy_preferences' } }
        });
        const strategyShifts = prefs ? prefs.value : 'Предпочтений от автора пока нет.';
        const systemPrompt = `Ты — Quarter Strategic Planner (QSP). Контент-директор IT-канала.
Твоя задача: Разработать макро-стратегию на 90 дней (Квартал) и разбить её на 3 логичных месяца (MonthArcs).

Внимание, стратегические корректировки от автора:
${strategyShifts}

Заполни и верни строго JSON объект:
{
  "strategic_goal": "строка (Awareness / Authority / Conversion / Launch)",
  "primary_pillar": "строка (основная сквозная тема квартала)",
  "months": [
    {
      "arc_theme": "строка (тема месяца 1)",
      "arc_thesis": "строка (главная мысль / тема месяца: Awareness / Cases / Presale)"
    },
    ...
  ]
}

Учитывай, что в рамках этого квартала мы используем следующий набор каналов и их ролей:
${plannedChannels ? JSON.stringify(plannedChannels, null, 2) : 'Стандартный набор (TG, VK)'}`;
        const quarterEnd = new Date(quarterStart);
        quarterEnd.setMonth(quarterEnd.getMonth() + 3);
        const userPrompt = `Создай план на квартал с ${quarterStart.toISOString().split('T')[0]} по ${quarterEnd.toISOString().split('T')[0]}.
Глобальная цель владельца: ${goalHint ? goalHint : 'Плавный прогрев аудитории и развитие экспертности.'}`;
        const resultStr = await this.callLLM(systemPrompt, userPrompt);
        let parsed;
        try {
            parsed = JSON.parse(resultStr);
        }
        catch (e) {
            console.error("Failed to parse QSP output", resultStr);
            throw new Error("QSP output invalid JSON");
        }
        const qp = await prisma.quarterPlan.create({
            data: {
                project_id: projectId,
                quarter_start: quarterStart,
                quarter_end: quarterEnd,
                strategic_goal: parsed.strategic_goal,
                primary_pillar: parsed.primary_pillar,
                monetization_focus: 'systemic step-by-step',
                planned_channels: plannedChannels || null
            }
        });
        // Create 3 Month Arcs and automatically spawn MTA for each
        const monthArcs = [];
        let currentMonthStart = new Date(quarterStart);
        for (let i = 0; i < 3; i++) {
            const mEnd = new Date(currentMonthStart);
            mEnd.setMonth(mEnd.getMonth() + 1);
            const monthData = parsed.months[i];
            const arc = await prisma.monthArc.create({
                data: {
                    project_id: projectId,
                    quarter_plan_id: qp.id,
                    month: new Date(currentMonthStart),
                    arc_theme: monthData.arc_theme,
                    arc_thesis: monthData.arc_thesis
                }
            });
            monthArcs.push(arc);
            // Advance to next month
            currentMonthStart = new Date(mEnd);
        }
        return { quarterPlan: qp, monthArcs };
    }
    /**
     * Monthly Tactical Agent (MTA)
     * Takes a MonthArc and automatically drafts exactly 4 WeekPackages for it.
     */
    async planMonth(monthArcId) {
        console.log(`[MTA] Planning month arc ${monthArcId}`);
        const arc = await prisma.monthArc.findUnique({
            where: { id: monthArcId },
            include: { quarter_plan: true }
        });
        if (!arc)
            throw new Error("MonthArc not found");
        const plannedChannels = arc.quarter_plan?.planned_channels || null;
        const systemPrompt = `Ты — Monthly Tactical Agent (MTA).
Твоя задача — разбить фокус-тему месяца '${arc.arc_theme}' на 4 логичные недели.
Каждая неделя должна иметь свою тему (theme) и главный тезис (thesis), которые поэтапно ведут аудиторию к главной мысли месяца '${arc.arc_thesis}'.
Учитывай, что общая цель квартала: '${arc.quarter_plan?.strategic_goal}'.

Верни JSON:
{
  "weeks": [
    {
      "week_theme": "строка",
      "core_thesis": "строка (1-2 предложения)",
      "intent_tag": "Awareness | Education | Proof | Sell",
      "channel_mix": {
        "tg_post": "number (0-10)",
        "vk_post": "number (0-10)",
        "habr_article": "number (0-2)",
        "video_script": "number (0-2)"
      }
    },
    ... (ровно 4 недели)
  ]
}

ВАЖНО: При формировании 'channel_mix' используй только те каналы, которые указаны в стратегии квартала (если указаны):
${plannedChannels ? JSON.stringify(plannedChannels, null, 2) : 'Любые доступные (TG, VK, Habr, Video)'}`;
        const userPrompt = `Разбей месяц на 4 недели.`;
        const resultStr = await this.callLLM(systemPrompt, userPrompt);
        const parsed = JSON.parse(resultStr);
        const weekPackages = [];
        let wStart = new Date(arc.month);
        // Snap to next Monday if not already
        const day = wStart.getDay();
        const diff = wStart.getDate() - day + (day === 0 ? -6 : 1);
        wStart = new Date(wStart.setDate(diff));
        for (let i = 0; i < 4; i++) {
            const wEnd = new Date(wStart);
            wEnd.setDate(wEnd.getDate() + 6);
            const weekData = parsed.weeks[i] || parsed.weeks[0];
            const smoothHint = `Стратегический фокус недели: ${weekData.week_theme}. Тезис: ${weekData.core_thesis}. Интент: ${weekData.intent_tag}. Месяц: ${arc.arc_theme}`;
            const newlyPlannedWeek = await this.planWeek(arc.project_id, new Date(wStart), new Date(wEnd), smoothHint, arc.id, weekData.channel_mix);
            // AUTO-ARCHITECT: Immediately slice the week into Content Items (posts)
            try {
                console.log(`[MTA] Auto-architecting week ${newlyPlannedWeek.id}`);
                await this.architectDistribution(newlyPlannedWeek.id, weekData.channel_mix);
            }
            catch (ae) {
                console.error(`[MTA] Auto-architecture failed for week ${newlyPlannedWeek.id}`, ae);
            }
            weekPackages.push(newlyPlannedWeek);
            // Advance next week
            wStart.setDate(wStart.getDate() + 7);
        }
        return weekPackages;
    }
    /**
     * Strategic Media Orchestrator (SMO)
     * Generates a WeekPackage strategy
     */
    async planWeek(projectId, weekStart, weekEnd, themeHint = "", monthArcId, channelMix) {
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
                month_arc_id: monthArcId || null,
                week_start: weekStart,
                week_end: weekEnd,
                week_theme: parsed.week_theme,
                core_thesis: parsed.core_thesis,
                audience_focus: parsed.audience_focus,
                intent_tag: parsed.intent_tag,
                monetization_tie: parsed.monetization_tie,
                narrative_arc: parsed.narrative_arc,
                risks: parsed.risks,
                channel_mix: channelMix || null,
                approval_status: 'draft'
            }
        });
    }
    /**
     * Distribution Architect (DA)
     * Breaks down the WeekPackage into ContentItems across channels and layers
     */
    async architectDistribution(weekPackageId, overrideChannelsSpec) {
        console.log(`[DA] Architecting distribution for week package ${weekPackageId}`);
        const wp = await prisma.weekPackage.findUnique({
            where: { id: weekPackageId },
            include: {
                month_arc: {
                    include: { quarter_plan: true }
                }
            }
        });
        if (!wp)
            throw new Error("WeekPackage not found");
        const plannedChannels = wp.month_arc?.quarter_plan?.planned_channels || null;
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
        const activeChannelsSpec = overrideChannelsSpec || wp.channel_mix || {
            "tg_post": 3,
            "vk_post": 1,
            "habr_article": 0,
            "video_script": 0
        };
        const userPrompt = `Week Strategy:
Theme: ${wp.week_theme}
Thesis: ${wp.core_thesis}
Intent: ${wp.intent_tag}
Narrative Arc: ${JSON.stringify(wp.narrative_arc)}

Requirements (Target Channel Mix Quotas):
${JSON.stringify(activeChannelsSpec, null, 2)}

Strategic Channel Roles (from Quarter Strategy):
${plannedChannels ? JSON.stringify(plannedChannels, null, 2) : 'No specific roles defined.'}

Распредели контент логично по дням недели (day_offset 0-6), чтобы поддержать Narrative Arc и роли каналов.`;
        const resultStr = await this.callLLM(systemPrompt, userPrompt);
        let parsed = { items: [], cross_links_strategy: [] };
        try {
            parsed = JSON.parse(resultStr);
        }
        catch (e) {
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
    async validateContinuity(weekPackageId) {
        console.log(`[NCC] Validating continuity for week package ${weekPackageId}`);
        // For MVP, we'll just pull the data, ask NCC to review, and store its report.
        const wp = await prisma.weekPackage.findUnique({
            where: { id: weekPackageId },
            include: { content_items: { orderBy: { schedule_at: 'asc' } } }
        });
        if (!wp)
            throw new Error("WeekPackage not found");
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
        }
        else {
            // Keep draft, allow owner to review
        }
        return report;
    }
}
exports.V2OrchestratorService = V2OrchestratorService;
exports.default = new V2OrchestratorService();
