import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class FaeService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    /**
     * Collects manual feedback from the owner via CLI/UI 
     * and analyzes it to generate strategic recommendations.
     */
    async processFeedback(projectId: number, period: 'week' | 'month', periodStart: Date, periodEnd: Date, ownerScores: any, notes: string) {
        console.log(`[FAE] Processing feedback for project ${projectId}...`);

        let perChannelMetrics = {}; // Placeholder for API integration later

        // For MVP, we pass the manually gathered scores and text notes to LLM
        // to produce a "Strategy Shift" recommendation
        const systemPrompt = `Ты — Feedback & Adaptation Engine (FAE) контент-завода.
Твоя задача — проанализировать фидбек владельца за неделю/месяц и выработать 2-3 четких рекомендации для Strategic Media Orchestrator (SMO) на будущие периоды.

Верни JSON:
{
    "recommendations": "Текстовое резюме, что изменить (глубину, частоту, темы, тон)",
    "applied_changes": "Конкретные правила-маркеры, которые мы сохраняем как preferences"
}`;

        const userPrompt = `
Оценки от автора:
- Глубина: ${ownerScores.depth}/10
- Стиль: ${ownerScores.style}/10
- Точность: ${ownerScores.accuracy}/10
- Польза: ${ownerScores.usefulness}/10

Комментарий автора: ${notes}

Предложи корректировки стратегии.`;

        const responseStr = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            response_format: { type: "json_object" }
        });

        const parsed = JSON.parse(responseStr.choices[0]?.message.content || '{}');

        const feedback = await prisma.feedbackPackage.create({
            data: {
                project_id: projectId,
                period: period,
                period_start: periodStart,
                period_end: periodEnd,
                per_channel_metrics: perChannelMetrics,
                owner_scores: ownerScores,
                notes: notes,
                recommendations: parsed.recommendations,
                applied_changes: parsed.applied_changes
            }
        });

        // Save preferences to ProjectSettings to influence SMO later
        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: 'fae_strategy_preferences'
                }
            },
            update: { value: parsed.applied_changes },
            create: { project_id: projectId, key: 'fae_strategy_preferences', value: parsed.applied_changes }
        });

        return feedback;
    }
}

export default new FaeService();
