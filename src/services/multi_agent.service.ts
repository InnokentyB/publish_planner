import OpenAI from 'openai';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();

interface CritiqueResult {
    score: number;
    critique: string;
}

interface MultiAgentResult {
    finalText: string;
    score: number;
    iterations: number;
    history: {
        iteration: number;
        score: number;
        critique: string;
    }[];
}

class MultiAgentService {
    private openai: OpenAI;
    private prisma: PrismaClient;

    // Keys for prompt settings
    public readonly KEY_CREATOR = 'multi_agent_creator';
    public readonly KEY_CRITIC = 'multi_agent_critic';
    public readonly KEY_FIXER = 'multi_agent_fixer';

    public readonly KEY_TOPIC_CREATOR = 'multi_agent_topic_creator';
    public readonly KEY_TOPIC_CRITIC = 'multi_agent_topic_critic';
    public readonly KEY_TOPIC_FIXER = 'multi_agent_topic_fixer';

    // Default prompts
    private readonly DEFAULT_CREATOR_PROMPT = `You are an expert content creator for a tech Telegram channel.
                 Your goal is to write engaging, insightful, and professionally formatted posts.
                 Use Markdown. Return ONLY the post text.
                 
                 Style Guide:
                 - Professional but accessible tone
                 - Clear structure with headers if needed
                 - No hashtags in the middle of text, only at the end (optional)
                 - Focus on value for the reader
                 - 3000-4000 characters max range`;

    private readonly DEFAULT_CRITIC_PROMPT = `You are a strict and highly critical editor for a tech blog.
                 You evaluate posts based on:
                 1. Relevance to topic
                 2. Depth of insight (no superficial fluff)
                 3. Clarity and Flow
                 4. Engagement hooks
                 5. Formatting
                 
                 Your output MUST be valid JSON in the following format:
                 {
                    "score": <number 0-100>,
                    "critique": "<detailed constructive feedback improvements>"
                 }
                 
                 Do not be afraid to give low scores (below 50) if the content is generic or boring.
                 A score of 100 means perfection.`;

    private readonly DEFAULT_FIXER_PROMPT = `You are an expert editor. Your task is to rewrite and improve a post based on specific critique.
                 Keep the original meaning but address ALL the points in the critique.
                 Make the text punchier, deeper, and better structured.
                 Return ONLY the improved post text.`;

    private readonly DEFAULT_TOPIC_CREATOR_PROMPT = `You are an expert content strategist. 
    Generate 14 unique, engaging, and valuable topics for a tech Telegram channel based on the provided theme.
    
    For each topic, provide:
    - topic: The title/subject
    - category: One of "Soft Skills", "Technologies", "Integrations", "Requirements"
    - tags: 2-4 relevant tags

    Return ONLY a JSON object with a "topics" property containing an array of objects.
    Example: { "topics": [{"topic": "...", "category": "...", "tags": [...]}, ...] }`;

    private readonly DEFAULT_TOPIC_CRITIC_PROMPT = `You are a critical content strategist. Review the proposed list of 14 topics.
    Critique based on:
    1. Variety (are they all the same?)
    2. Relevance to the theme
    3. Engagement potential (are they boring?)
    4. Balance of categories

    Your output MUST be valid JSON:
    {
        "score": <number 0-100>,
        "critique": "<detailed feedback>"
    }`;

    private readonly DEFAULT_TOPIC_FIXER_PROMPT = `You are an expert content strategist. Fix the list of topics based on the critique.
    Ensure there are exactly 14 topics.
    Return ONLY a JSON object with a "topics" property containing an array of objects.`;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const connectionString = process.env.DATABASE_URL;
        const pool = new Pool({ connectionString });
        const adapter = new PrismaPg(pool);
        this.prisma = new PrismaClient({ adapter });
    }

    private async getPrompt(key: string, defaultVal: string): Promise<string> {
        try {
            const setting = await this.prisma.promptSettings.findUnique({ where: { key } });
            if (setting) return setting.value;

            // Create default if missing
            await this.prisma.promptSettings.create({
                data: { key, value: defaultVal }
            });
            return defaultVal;
        } catch (e) {
            console.error(`Failed to fetch prompt for ${key}`, e);
            return defaultVal;
        }
    }

    // --- Single Post Generation ---

    async run(topic: string): Promise<MultiAgentResult> {
        console.log(`[MultiAgent] Starting generation for topic: "${topic}"`);

        let runLogId = 0;
        try {
            const runLog = await this.prisma.agentRun.create({
                data: {
                    topic: topic
                }
            });
            runLogId = runLog.id;
        } catch (e) {
            console.error('Failed to create run log', e);
        }

        const creatorPrompt = await this.getPrompt(this.KEY_CREATOR, this.DEFAULT_CREATOR_PROMPT);
        let currentText = await this.creator(topic, creatorPrompt, runLogId);

        let currentScore = 0;
        let iterations = 0;
        const history = [];

        const MAX_ITERATIONS = 3;
        const TARGET_SCORE = 85;

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            console.log(`[MultiAgent] Iteration ${iterations} starting...`);

            const criticPrompt = await this.getPrompt(this.KEY_CRITIC, this.DEFAULT_CRITIC_PROMPT);
            const fixerPrompt = await this.getPrompt(this.KEY_FIXER, this.DEFAULT_FIXER_PROMPT);

            const critiqueResult = await this.critic(currentText, topic, criticPrompt, runLogId, iterations);
            currentScore = critiqueResult.score;

            history.push({
                iteration: iterations,
                score: currentScore,
                critique: critiqueResult.critique
            });

            console.log(`[MultiAgent] Iteration ${iterations} score: ${currentScore}`);

            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: {
                            final_score: currentScore,
                            total_iterations: iterations
                        }
                    });
                } catch (e) { console.error('Failed to update run log', e); }
            }

            if (currentScore >= TARGET_SCORE) {
                console.log(`[MultiAgent] Target score reached!`);
                break;
            }

            if (iterations < MAX_ITERATIONS) {
                console.log(`[MultiAgent] Fixing text based on critique...`);
                currentText = await this.fixer(currentText, critiqueResult.critique, fixerPrompt, runLogId, iterations);
            }
        }

        return {
            finalText: currentText,
            score: currentScore,
            iterations,
            history
        };
    }

    private async creator(topic: string, systemPrompt: string, runId: number): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Write a post about: ${topic}` }
            ],
            temperature: 0.7
        });
        const output = response.choices[0].message.content || '';

        if (runId > 0) {
            try {
                await this.prisma.agentIteration.create({
                    data: {
                        run_id: runId,
                        iteration_number: 0,
                        agent_role: 'creator',
                        input: topic,
                        output: output
                    }
                });
            } catch (e) { console.error('Failed to log creator iteration', e); }
        }

        return output;
    }

    private async critic(text: string, topic: string, systemPrompt: string, runId: number, iteration: number): Promise<CritiqueResult> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Topic: ${topic}\n\nPost to evaluate:\n${text}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        let result: CritiqueResult;
        try {
            const content = response.choices[0].message.content || '{}';
            result = JSON.parse(content) as CritiqueResult;
        } catch (e) {
            console.error('[MultiAgent] Failed to parse critic output', e);
            result = { score: 50, critique: "Failed to parse critique. Please review manually." };
        }

        if (runId > 0) {
            try {
                await this.prisma.agentIteration.create({
                    data: {
                        run_id: runId,
                        iteration_number: iteration,
                        agent_role: 'critic',
                        input: text.substring(0, 1000) + '...',
                        output: JSON.stringify(result),
                        score: result.score,
                        critique: result.critique
                    }
                });
            } catch (e) { console.error('Failed to log critic iteration', e); }
        }

        return result;
    }

    private async fixer(text: string, critique: string, systemPrompt: string, runId: number, iteration: number): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Original Text:\n${text}\n\nCritique to address:\n${critique}` }
            ],
            temperature: 0.7
        });
        const output = response.choices[0].message.content || text;

        if (runId > 0) {
            try {
                await this.prisma.agentIteration.create({
                    data: {
                        run_id: runId,
                        iteration_number: iteration,
                        agent_role: 'fixer',
                        input: `Critique: ${critique.substring(0, 200)}...`,
                        output: output
                    }
                });
            } catch (e) { console.error('Failed to log fixer iteration', e); }
        }

        return output;
    }

    // --- Topic List Generation ---

    async refineTopics(theme: string): Promise<{ topic: string, category: string, tags: string[] }[]> {
        console.log(`[MultiAgent] Starting topic generation for theme: "${theme}"`);

        // 1. Create Run Log (Topics)
        let runLogId = 0;
        try {
            const runLog = await this.prisma.agentRun.create({
                data: { topic: `TOPICS: ${theme}` }
            });
            runLogId = runLog.id;
        } catch (e) { console.error('Failed to create run log', e); }

        // Creator
        const creatorPrompt = await this.getPrompt(this.KEY_TOPIC_CREATOR, this.DEFAULT_TOPIC_CREATOR_PROMPT);
        let currentTopicsJSON = await this.topicCreator(theme, creatorPrompt, runLogId);

        // Ensure it's valid JSON structure from the start
        try {
            const parsed = JSON.parse(currentTopicsJSON);
            if (!parsed.topics && Array.isArray(parsed)) {
                // Handle raw array return by wrapping it
                currentTopicsJSON = JSON.stringify({ topics: parsed });
            }
        } catch (e) { }

        let currentScore = 0;
        let iterations = 0;
        const MAX_ITERATIONS = 3;
        const TARGET_SCORE = 90; // Higher bar for topics

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            console.log(`[MultiAgent Topics] Iteration ${iterations} starting...`);

            const criticPrompt = await this.getPrompt(this.KEY_TOPIC_CRITIC, this.DEFAULT_TOPIC_CRITIC_PROMPT);
            const fixerPrompt = await this.getPrompt(this.KEY_TOPIC_FIXER, this.DEFAULT_TOPIC_FIXER_PROMPT);

            // Critic
            const critiqueResult = await this.topicCritic(currentTopicsJSON, theme, criticPrompt, runLogId, iterations);
            currentScore = critiqueResult.score;
            console.log(`[MultiAgent Topics] Iteration ${iterations} score: ${currentScore}`);

            // Update Log
            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: { final_score: currentScore, total_iterations: iterations }
                    });
                } catch (e) { }
            }

            if (currentScore >= TARGET_SCORE) {
                console.log(`[MultiAgent Topics] Target score reached!`);
                break;
            }

            if (iterations < MAX_ITERATIONS) {
                // Fixer
                console.log(`[MultiAgent Topics] Fixing based on critique...`);
                currentTopicsJSON = await this.topicFixer(currentTopicsJSON, critiqueResult.critique, fixerPrompt, runLogId, iterations);
            }
        }

        // Parse final JSON
        try {
            const parsed = JSON.parse(currentTopicsJSON);
            const topics = parsed.topics || parsed;
            if (Array.isArray(topics)) return topics;
            return [];
        } catch (e) {
            console.error('Failed to parse final topics JSON', e);
            return [];
        }
    }

    private async topicCreator(theme: string, systemPrompt: string, runId: number): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Theme: ${theme}` }
            ],
            temperature: 0.7,
            response_format: { type: "json_object" }
        });
        const output = response.choices[0].message.content || '{}';

        if (runId > 0) {
            try {
                await this.prisma.agentIteration.create({
                    data: {
                        run_id: runId,
                        iteration_number: 0,
                        agent_role: 'topic_creator',
                        input: theme,
                        output: output
                    }
                });
            } catch (e) { console.error('Log error', e); }
        }
        return output;
    }

    private async topicCritic(topicsJSON: string, theme: string, systemPrompt: string, runId: number, iteration: number): Promise<CritiqueResult> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Theme: ${theme}\n\nTopics JSON:\n${topicsJSON}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        let result: CritiqueResult;
        try {
            const content = response.choices[0].message.content || '{}';
            result = JSON.parse(content) as CritiqueResult;
        } catch (e) {
            result = { score: 50, critique: "Failed to parse critique." };
        }

        if (runId > 0) {
            await this.prisma.agentIteration.create({
                data: {
                    run_id: runId,
                    iteration_number: iteration,
                    agent_role: 'topic_critic',
                    input: topicsJSON.substring(0, 1000) + '...',
                    output: JSON.stringify(result),
                    score: result.score,
                    critique: result.critique
                }
            }).catch(console.error);
        }
        return result;
    }

    private async topicFixer(topicsJSON: string, critique: string, systemPrompt: string, runId: number, iteration: number): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Original Topics:\n${topicsJSON}\n\nCritique:\n${critique}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.7
        });
        const output = response.choices[0].message.content || topicsJSON;

        if (runId > 0) {
            await this.prisma.agentIteration.create({
                data: {
                    run_id: runId,
                    iteration_number: iteration,
                    agent_role: 'topic_fixer',
                    input: `Critique: ${critique.substring(0, 200)}...`,
                    output: output
                }
            }).catch(console.error);
        }
        return output;
    }
}

export default new MultiAgentService();
