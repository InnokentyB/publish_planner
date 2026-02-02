import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

    // Keys for Post Generation Agents
    public readonly KEY_POST_CREATOR_PROMPT = 'multi_agent_post_creator_prompt';
    public readonly KEY_POST_CREATOR_KEY = 'multi_agent_post_creator_key';
    public readonly KEY_POST_CREATOR_MODEL = 'multi_agent_post_creator_model';

    public readonly KEY_POST_CRITIC_PROMPT = 'multi_agent_post_critic_prompt';
    public readonly KEY_POST_CRITIC_KEY = 'multi_agent_post_critic_key';
    public readonly KEY_POST_CRITIC_MODEL = 'multi_agent_post_critic_model';

    public readonly KEY_POST_FIXER_PROMPT = 'multi_agent_post_fixer_prompt';
    public readonly KEY_POST_FIXER_KEY = 'multi_agent_post_fixer_key';
    public readonly KEY_POST_FIXER_MODEL = 'multi_agent_post_fixer_model';

    // Keys for Topic Generation Agents
    public readonly KEY_TOPIC_CREATOR_PROMPT = 'multi_agent_topic_creator_prompt';
    public readonly KEY_TOPIC_CREATOR_KEY = 'multi_agent_topic_creator_key';
    public readonly KEY_TOPIC_CREATOR_MODEL = 'multi_agent_topic_creator_model';

    public readonly KEY_TOPIC_CRITIC_PROMPT = 'multi_agent_topic_critic_prompt';
    public readonly KEY_TOPIC_CRITIC_KEY = 'multi_agent_topic_critic_key';
    public readonly KEY_TOPIC_CRITIC_MODEL = 'multi_agent_topic_critic_model';

    public readonly KEY_TOPIC_FIXER_PROMPT = 'multi_agent_topic_fixer_prompt';
    public readonly KEY_TOPIC_FIXER_KEY = 'multi_agent_topic_fixer_key';
    public readonly KEY_TOPIC_FIXER_MODEL = 'multi_agent_topic_fixer_model';

    // Default Propmts for Post Generation (similar to legacy but split)
    private readonly DEFAULT_POST_CREATOR_PROMPT = `You are an expert content creator. Write an engaging, insightful, and professionally formatted Telegram post about the given topic. Use Markdown. Focus on value. Max 4000 chars. Language: Russian.`;
    private readonly DEFAULT_POST_CRITIC_PROMPT = `You are a strict editor. Evaluate the post based on relevance, insight, clarity, engagement, and formatting. Output JSON with "score" (0-100) and "critique" (in Russian).`;
    private readonly DEFAULT_POST_FIXER_PROMPT = `You are an expert editor. Rewrite the post to address the critique while keeping the original meaning. Language: Russian. 

CRITICAL: Return ONLY the improved post text itself. Do NOT include:
- Any meta-commentary about what you changed
- Explanations of improvements
- Analysis of the critique
- Introductory phrases like "Here's the improved version" or "Замечательная работа"

Start directly with the post content.`;

    // Default Prompts for Topic Generation (Restored)
    private readonly DEFAULT_TOPIC_CREATOR_PROMPT = `You are an expert content strategist. 
    Generate 2 unique, engaging, and valuable topics for a tech Telegram channel based on the provided theme.
    
    For each topic, provide:
    - topic: The title/subject
    - category: One of "Soft Skills", "Technologies", "Integrations", "Requirements"
    - tags: 2-4 relevant tags

    Return ONLY a JSON object with a "topics" property containing an array of objects.
    Example: { "topics": [{"topic": "...", "category": "...", "tags": [...]}, ...] }`;

    private readonly DEFAULT_TOPIC_CRITIC_PROMPT = `You are a critical content strategist. Review the proposed list of 2 topics.
    Critique based on:
    1. Variety (are they all the same?)
    2. Relevance to the theme
    3. Engagement potential (are they boring?)
    4. Balance of categories

    Your output MUST be valid JSON:
    {
        "score": <number 0-100>,
        "critique": "<detailed feedback in Russian>"
    }`;

    private readonly DEFAULT_TOPIC_FIXER_PROMPT = `You are an expert content strategist. Fix the list of topics based on the critique.
    Ensure there are exactly 2 topics.
    The content MUST be in Russian.
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

    private async getPrompt(projectId: number, key: string, defaultVal: string): Promise<string> {
        try {
            const setting = await this.prisma.projectSettings.findUnique({
                where: {
                    project_id_key: {
                        project_id: projectId,
                        key: key
                    }
                }
            });
            if (setting) return setting.value;

            // Create default if missing for this project
            await this.prisma.projectSettings.create({
                data: { project_id: projectId, key, value: defaultVal }
            });
            return defaultVal;
        } catch (e) {
            console.error(`Failed to fetch prompt for ${key} in project ${projectId}`, e);
            return defaultVal;
        }
    }

    public async getAgentConfig(projectId: number, rolePrefix: string) {
        let apiKeyKey = '';
        let modelKey = '';
        let promptKey = '';
        let defaultPrompt = '';

        if (rolePrefix === 'post_creator') {
            apiKeyKey = this.KEY_POST_CREATOR_KEY;
            modelKey = this.KEY_POST_CREATOR_MODEL;
            promptKey = this.KEY_POST_CREATOR_PROMPT;
            defaultPrompt = this.DEFAULT_POST_CREATOR_PROMPT;
        } else if (rolePrefix === 'post_critic') {
            apiKeyKey = this.KEY_POST_CRITIC_KEY;
            modelKey = this.KEY_POST_CRITIC_MODEL;
            promptKey = this.KEY_POST_CRITIC_PROMPT;
            defaultPrompt = this.DEFAULT_POST_CRITIC_PROMPT;
        } else if (rolePrefix === 'post_fixer') {
            apiKeyKey = this.KEY_POST_FIXER_KEY;
            modelKey = this.KEY_POST_FIXER_MODEL;
            promptKey = this.KEY_POST_FIXER_PROMPT;
            defaultPrompt = this.DEFAULT_POST_FIXER_PROMPT;
        } else if (rolePrefix === 'topic_creator') {
            apiKeyKey = this.KEY_TOPIC_CREATOR_KEY;
            modelKey = this.KEY_TOPIC_CREATOR_MODEL;
            promptKey = this.KEY_TOPIC_CREATOR_PROMPT;
            defaultPrompt = this.DEFAULT_TOPIC_CREATOR_PROMPT;
        } else if (rolePrefix === 'topic_critic') {
            apiKeyKey = this.KEY_TOPIC_CRITIC_KEY;
            modelKey = this.KEY_TOPIC_CRITIC_MODEL;
            promptKey = this.KEY_TOPIC_CRITIC_PROMPT;
            defaultPrompt = this.DEFAULT_TOPIC_CRITIC_PROMPT;
        } else if (rolePrefix === 'topic_fixer') {
            apiKeyKey = this.KEY_TOPIC_FIXER_KEY;
            modelKey = this.KEY_TOPIC_FIXER_MODEL;
            promptKey = this.KEY_TOPIC_FIXER_PROMPT;
            defaultPrompt = this.DEFAULT_TOPIC_FIXER_PROMPT;
        }

        const apiKey = await this.getPrompt(projectId, apiKeyKey, '');
        const model = await this.getPrompt(projectId, modelKey, 'gpt-4o');
        const prompt = await this.getPrompt(projectId, promptKey, defaultPrompt);

        return {
            apiKey: apiKey || process.env.OPENAI_API_KEY, // Fallback to env
            model,
            prompt
        };
    }

    // --- Post Generation Loop (New) ---

    async runPostGeneration(projectId: number, theme: string, topic: string): Promise<MultiAgentResult> {
        console.log(`[MultiAgent Post] Starting generation for: "${topic}"`);

        let runLogId = 0;
        try {
            const runLog = await this.prisma.agentRun.create({
                data: { topic: `POST: ${topic}` }
            });
            runLogId = runLog.id;
        } catch (e) { console.error('Failed to create run log', e); }

        const creatorConfig = await this.getAgentConfig(projectId, 'post_creator');
        let currentText = await this.postCreator(theme, topic, creatorConfig, runLogId);

        let currentScore = 0;
        let iterations = 0;
        const history = [];
        const MAX_ITERATIONS = 3;
        const TARGET_SCORE = 80;

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            console.log(`[MultiAgent Post] Iteration ${iterations} starting...`);

            const criticConfig = await this.getAgentConfig(projectId, 'post_critic');
            const fixerConfig = await this.getAgentConfig(projectId, 'post_fixer');

            const critiqueResult = await this.postCritic(currentText, topic, criticConfig, runLogId, iterations);
            currentScore = critiqueResult.score;

            history.push({
                iteration: iterations,
                score: currentScore,
                critique: critiqueResult.critique
            });

            console.log(`[MultiAgent Post] Iteration ${iterations} score: ${currentScore}`);

            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: { final_score: currentScore, total_iterations: iterations }
                    });
                } catch (e) { }
            }

            if (currentScore >= TARGET_SCORE) {
                console.log(`[MultiAgent Post] Target score reached!`);
                break;
            }

            if (iterations < MAX_ITERATIONS) {
                console.log(`[MultiAgent Post] Fixing text based on critique...`);
                currentText = await this.postFixer(currentText, critiqueResult.critique, fixerConfig, runLogId, iterations);
            }
        }

        return {
            finalText: currentText,
            score: currentScore,
            iterations,
            history
        };
    }

    private async postCreator(theme: string, topic: string, config: any, runId: number): Promise<string> {
        let output = '';
        if (config.apiKey && config.apiKey.startsWith('sk-ant')) {
            // Use Anthropic
            const anthropic = new Anthropic({ apiKey: config.apiKey });
            const response = await anthropic.messages.create({
                model: config.model,
                max_tokens: 4000,
                system: config.prompt,
                messages: [
                    { role: 'user', content: `Theme: ${theme}\nPost Topic: ${topic}` }
                ]
            });
            // @ts-ignore
            output = response.content[0].text || '';
        } else if (config.apiKey && config.apiKey.startsWith('AIza')) {
            // Use Gemini
            const genAI = new GoogleGenerativeAI(config.apiKey);
            const model = genAI.getGenerativeModel({
                model: config.model,
                systemInstruction: config.prompt
            });
            const result = await model.generateContent(`Theme: ${theme}\nPost Topic: ${topic}`);
            output = result.response.text();
        } else {
            // Use OpenAI (Default)
            const client = new OpenAI({ apiKey: config.apiKey });
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [
                    { role: 'system', content: config.prompt },
                    { role: 'user', content: `Theme: ${theme}\nPost Topic: ${topic}` }
                ],
                temperature: 0.7
            });
            output = response.choices[0].message.content || '';
        }

        if (runId > 0) {
            await this.prisma.agentIteration.create({
                data: {
                    run_id: runId, iteration_number: 0, agent_role: 'post_creator',
                    input: topic, output: output
                }
            }).catch(console.error);
        }
        return output;
    }

    private async postCritic(text: string, topic: string, config: any, runId: number, iteration: number): Promise<CritiqueResult> {
        let result: CritiqueResult = { score: 50, critique: '' };
        let content = '{}';

        if (config.apiKey && config.apiKey.startsWith('sk-ant')) {
            const anthropic = new Anthropic({ apiKey: config.apiKey });
            // Claude doesn't have JSON mode enforcement like OpenAI, so we ask politely in prompt
            const response = await anthropic.messages.create({
                model: config.model,
                max_tokens: 1000,
                system: config.prompt + "\nIMPORTANT: You MUST return valid JSON only.",
                messages: [
                    { role: 'user', content: `Topic: ${topic}\n\nPost to evaluate:\n${text}` }
                ]
            });
            // @ts-ignore
            content = response.content[0].text || '{}';
        } else if (config.apiKey && config.apiKey.startsWith('AIza')) {
            // Use Gemini
            const genAI = new GoogleGenerativeAI(config.apiKey);
            const model = genAI.getGenerativeModel({
                model: config.model,
                systemInstruction: config.prompt + "\nIMPORTANT: You MUST return valid JSON only.",
                generationConfig: { responseMimeType: "application/json" }
            });
            const result = await model.generateContent(`Topic: ${topic}\n\nPost to evaluate:\n${text}`);
            content = result.response.text();
        } else {
            const client = new OpenAI({ apiKey: config.apiKey });
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [
                    { role: 'system', content: config.prompt },
                    { role: 'user', content: `Topic: ${topic}\n\nPost to evaluate:\n${text}` }
                ],
                response_format: { type: "json_object" },
                temperature: 0.3
            });
            content = response.choices[0].message.content || '{}';
        }

        try {
            // Attempt to extract JSON object from text (handles text before/after JSON)
            let cleaned = content.trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            }

            const parsed = JSON.parse(cleaned);

            // Map alternative keys that LLMs sometimes use
            result = {
                score: typeof parsed.score === 'number' ? parsed.score : (typeof parsed.points === 'number' ? parsed.points : 50),
                critique: parsed.critique || parsed.comment || parsed.feedback || parsed.reasons || "No specific critique provided."
            };
        } catch (e) {
            result = { score: 50, critique: "Failed to parse critique from response." };
            console.error('JSON Parse Error. Full Content:', content);
        }

        if (runId > 0) {
            await this.prisma.agentIteration.create({
                data: {
                    run_id: runId, iteration_number: iteration, agent_role: 'post_critic',
                    input: text.substring(0, 1000) + '...',
                    output: JSON.stringify(result),
                    score: result.score, critique: result.critique
                }
            }).catch(console.error);
        }
        return result;
    }

    private async postFixer(text: string, critique: string, config: any, runId: number, iteration: number): Promise<string> {
        let output = '';

        if (config.apiKey && config.apiKey.startsWith('sk-ant')) {
            const anthropic = new Anthropic({ apiKey: config.apiKey });
            const response = await anthropic.messages.create({
                model: config.model,
                max_tokens: 4000,
                system: config.prompt,
                messages: [
                    { role: 'user', content: `Original Text:\n${text}\n\nCritique to address:\n${critique}` }
                ]
            });
            // @ts-ignore
            output = response.content[0].text || '';
        } else if (config.apiKey && config.apiKey.startsWith('AIza')) {
            // Use Gemini
            const genAI = new GoogleGenerativeAI(config.apiKey);
            const model = genAI.getGenerativeModel({
                model: config.model,
                systemInstruction: config.prompt
            });
            const result = await model.generateContent(`Original Text:\n${text}\n\nCritique to address:\n${critique}`);
            output = result.response.text();
        } else {
            const client = new OpenAI({ apiKey: config.apiKey });
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [
                    { role: 'system', content: config.prompt },
                    { role: 'user', content: `Original Text:\n${text}\n\nCritique to address:\n${critique}` }
                ],
                temperature: 0.7
            });
            output = response.choices[0].message.content || text;
        }

        if (runId > 0) {
            await this.prisma.agentIteration.create({
                data: {
                    run_id: runId, iteration_number: iteration, agent_role: 'post_fixer',
                    input: `Critique: ${(critique || '').substring(0, 200)}...`,
                    output: output
                }
            }).catch(console.error);
        }
        return output;
    }

    // --- Legacy / Topic Generation ---

    // Keys for prompt settings (Topics)
    public readonly KEY_TOPIC_CREATOR = 'multi_agent_topic_creator';
    public readonly KEY_TOPIC_CRITIC = 'multi_agent_topic_critic';
    public readonly KEY_TOPIC_FIXER = 'multi_agent_topic_fixer';

    // Legacy Single Post (Keeping for backward compatibility if needed, but confusingly named 'run')
    public readonly KEY_CREATOR = 'multi_agent_creator';
    public readonly KEY_CRITIC = 'multi_agent_critic';
    public readonly KEY_FIXER = 'multi_agent_fixer';

    // ... rest of the file ...

    // --- Topic List Generation ---

    async refineTopics(projectId: number, theme: string): Promise<{ topics: { topic: string, category: string, tags: string[] }[], score: number }> {
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
        const creatorPrompt = await this.getPrompt(projectId, this.KEY_TOPIC_CREATOR, this.DEFAULT_TOPIC_CREATOR_PROMPT);
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
        const TARGET_SCORE = 80; // Changed from 90 to 80

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            console.log(`[MultiAgent Topics] Iteration ${iterations} starting...`);

            const criticPrompt = await this.getPrompt(projectId, this.KEY_TOPIC_CRITIC, this.DEFAULT_TOPIC_CRITIC_PROMPT);
            const fixerPrompt = await this.getPrompt(projectId, this.KEY_TOPIC_FIXER, this.DEFAULT_TOPIC_FIXER_PROMPT);

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
                console.log(`[MultiAgent Topics] Target score (${TARGET_SCORE}) reached! Stopping early.`);
                break;
            }

            if (iterations < MAX_ITERATIONS) {
                // Fixer
                console.log(`[MultiAgent Topics] Fixing based on critique...`);
                currentTopicsJSON = await this.topicFixer(currentTopicsJSON, critiqueResult.critique, fixerPrompt, runLogId, iterations);
            }
        }

        // Parse final JSON
        let topics: any[] = [];
        try {
            const parsed = JSON.parse(currentTopicsJSON);
            topics = parsed.topics || parsed;
            if (!Array.isArray(topics)) topics = [];
        } catch (e) {
            console.error('Failed to parse final topics JSON', e);
            topics = [];
        }

        return { topics, score: currentScore };
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
