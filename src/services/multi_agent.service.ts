import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import commentService from './comment.service';

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

    public readonly KEY_POST_CLASSIFIER = 'post_classifier';
    public readonly DEFAULT_POST_CLASSIFIER_PROMPT = "You are an AI classifier. Analyze the provided social media post and determine the best category for it (e.g., 'Soft Skills', 'Tech News', 'Tutorial', 'Opinion', 'Case Study'). Also, generate exactly 3 relevant hashtags. Return ONLY a JSON object with keys 'category' (string) and 'tags' (array of strings).";

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

    // Default Prompts for Topic Generation (Restored & Localized)
    private readonly DEFAULT_TOPIC_CREATOR_PROMPT = `Ты — TopicAgent, генератор тем для Telegram-канала про системный и бизнес-анализ в IT.

Контекст:
Автор канала — опытный системный аналитик и технический продакт.
Стиль — профессиональный, прямой, иногда ироничный и критичный.
Мы не пишем учебники и не «объясняем основы», а вскрываем реальные проблемы, конфликты и антипаттерны.

Твоя задача:
На основе темы недели сгенерировать запрошенное количество тем для постов.

Требования к темам:
- Каждая тема должна содержать ЯВНЫЙ конфликт.
- Темы не должны повторять друг друга по смыслу.
- Заголовки — цепляющие, но не кликбейт.
- Тон — живой, не менторский.

Формат ответа:
Верни ТОЛЬКО JSON строго по схеме:
{ "topics": [{"topic": "...", "category": "...", "tags": [...]}, ...] }
Никакого текста вне JSON.`;

    private readonly DEFAULT_TOPIC_CRITIC_PROMPT = `Ты — TopicCriticAgent, строгий редактор и критик контент-плана.

Твоя задача — оценить список тем для Telegram-канала.

Критерии оценки:
1. Разнообразие.
2. Уникальность.
3. Конфликт.
4. Сила заголовка.
5. Хук.

Оцени план по шкале 0–100.

Формат:
Верни ТОЛЬКО JSON:
{
    "score": <number 0-100>,
    "critique": "<detailed feedback in Russian>"
}`;

    private readonly DEFAULT_TOPIC_FIXER_PROMPT = `Ты — TopicFixerAgent, автоматический редактор контент-плана.

Твоя задача:
Применить правки, предложенные TopicCriticAgent, к списку тем.

Правила:
- Используй ТОЛЬКО входные данные.
- Не добавляй новые темы по собственной инициативе.
- Сохраняй исходные index тем.

Тон тем должен соответствовать исходному стилю канала.

Формат:
Верни ТОЛЬКО JSON с объектом { "topics": [...] }.
Никакого текста вне JSON.`;

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

        let apiKey = await this.getPrompt(projectId, apiKeyKey, '');
        const model = await this.getPrompt(projectId, modelKey, 'gpt-4o');
        const prompt = await this.getPrompt(projectId, promptKey, defaultPrompt);

        // Resolve Provider Key if it starts with pk_
        if (apiKey && apiKey.startsWith('pk_')) {
            const keyId = parseInt(apiKey.substring(3));
            if (!isNaN(keyId)) {
                const providerKey = await this.prisma.providerKey.findUnique({
                    where: { id: keyId }
                });
                if (providerKey) {
                    apiKey = providerKey.key;
                } else {
                    console.warn(`Provider Key ${keyId} not found for project ${projectId}`);
                    apiKey = ''; // Or keep as is? Better to fail if key is missing.
                }
            }
        }

        return {
            apiKey: apiKey || process.env.OPENAI_API_KEY || '', // Fallback to env
            model,
            prompt
        };
    }

    // --- Post Generation Loop (New) ---

    async runPostGeneration(projectId: number, theme: string, topic: string, postId: number, promptOverride?: string, withImage: boolean = false): Promise<MultiAgentResult & { category?: string, tags?: string[] }> {
        console.log(`[MultiAgent Post] Starting generation for: "${topic}" (Image: ${withImage})`);

        // Fetch comments for context
        let commentsContext = await commentService.getCommentsForContext(projectId, 'post', postId);
        if (commentsContext) {
            console.log(`[MultiAgent Post] Found comments: ${commentsContext.length} chars`);
        } else {
            commentsContext = '';
        }

        // Define Strict Constraints
        let lengthConstraint = "";
        if (withImage) {
            lengthConstraint = "STRICT_LIMIT: The text MUST be under 950 characters (including spaces). This is for a Telegram post with an image (caption limit). If you exceed this, the post fails. Prioritize brevity over detail.";
        } else {
            lengthConstraint = "LIMIT: Target length is 2000-2500 characters. Max 4000. Ensure deep coverage of the topic, do not be too brief.";
        }

        // Add to creator context
        commentsContext += `\n\n[CONSTRAINT]: ${lengthConstraint}`;

        let runLogId = 0;
        try {
            const runLog = await this.prisma.agentRun.create({
                data: { topic: `POST: ${topic}` }
            });
            runLogId = runLog.id;
        } catch (e) { console.error('Failed to create run log', e); }

        const creatorConfig = await this.getAgentConfig(projectId, 'post_creator');
        if (promptOverride) {
            creatorConfig.prompt = promptOverride;
            console.log('[MultiAgent Post] Using prompt override');
        }

        // Remove conflicting default max length from prompt if present
        if (creatorConfig.prompt.includes("Max 4000 chars") && withImage) {
            creatorConfig.prompt = creatorConfig.prompt.replace("Max 4000 chars", "Max 1000 chars");
        }

        let currentText = await this.postCreator(theme, topic, creatorConfig, runLogId, commentsContext);

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

            // Pass constraint to Critic
            const critiqueResult = await this.postCritic(currentText, topic, criticConfig, runLogId, iterations, lengthConstraint);
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
                // Pass constraint to Fixer
                currentText = await this.postFixer(currentText, critiqueResult.critique, fixerConfig, runLogId, iterations, lengthConstraint);
            }
        }

        // Run Classifier
        let category: string | undefined;
        let tags: string[] | undefined;
        try {
            console.log('[MultiAgent Post] Running Classifier...');
            const classifierConfig = await this.getAgentConfig(projectId, this.KEY_POST_CLASSIFIER);
            // Use default prompt if not configured in DB (which it likely isn't yet)
            if (!classifierConfig.prompt || classifierConfig.prompt === this.DEFAULT_POST_CREATOR_PROMPT) {
                classifierConfig.prompt = this.DEFAULT_POST_CLASSIFIER_PROMPT;
            }

            const classification = await this.postClassifier(currentText, classifierConfig);
            category = classification.category;
            tags = classification.tags;
            console.log('[MultiAgent Post] Classification result:', classification);
        } catch (e) {
            console.error('[MultiAgent Post] Classification failed:', e);
        }

        return {
            finalText: currentText,
            score: currentScore,
            iterations,
            history,
            category,
            tags
        };
    }

    private async postClassifier(text: string, config: any): Promise<{ category: string, tags: string[] }> {
        let output = '{}';

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o', // Force JSON capable model
            messages: [
                { role: 'system', content: config.prompt || this.DEFAULT_POST_CLASSIFIER_PROMPT },
                { role: 'user', content: `Post Content:\n${text}` }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        output = response.choices[0].message.content || '{}';

        try {
            return JSON.parse(output);
        } catch (e) {
            console.error('Failed to parse classifier output', output);
            return { category: 'General', tags: [] };
        }
    }

    private async postCreator(theme: string, topic: string, config: any, runId: number, additionalContext: string = ''): Promise<string> {
        let output = '';

        let userContent = `Theme: ${theme}\nPost Topic: ${topic}`;
        if (additionalContext) {
            userContent += `\n\nUSER COMMENTS / REQUIREMENTS:\n${additionalContext}`;
        }

        if (config.apiKey && config.apiKey.startsWith('sk-ant')) {
            // Use Anthropic
            const anthropic = new Anthropic({ apiKey: config.apiKey });
            const response = await anthropic.messages.create({
                model: config.model,
                max_tokens: 4000,
                system: config.prompt,
                messages: [
                    { role: 'user', content: userContent }
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
            const result = await model.generateContent(userContent);
            output = result.response.text();
        } else {
            // Use OpenAI (Default)
            const client = new OpenAI({ apiKey: config.apiKey });
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [
                    { role: 'system', content: config.prompt },
                    { role: 'user', content: userContent }
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

    private async postCritic(text: string, topic: string, config: any, runId: number, iteration: number, lengthConstraint: string = ''): Promise<CritiqueResult> {
        let result: CritiqueResult = { score: 50, critique: '' };
        let content = '{}';

        const context = `Topic: ${topic}\n\nPost to evaluate:\n${text}\n\n${lengthConstraint ? `CRITICAL CONSTRAINT TO VERIFY: ${lengthConstraint}. If text exceeds limit, SCORE MUST BE < 50 and critique must demand shortening.` : ''}`;

        if (config.apiKey && config.apiKey.startsWith('sk-ant')) {
            const anthropic = new Anthropic({ apiKey: config.apiKey });
            // Claude doesn't have JSON mode enforcement like OpenAI, so we ask politely in prompt
            const response = await anthropic.messages.create({
                model: config.model,
                max_tokens: 1000,
                system: config.prompt + "\nIMPORTANT: You MUST return valid JSON only.",
                messages: [
                    { role: 'user', content: context }
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
            const result = await model.generateContent(context);
            content = result.response.text();
        } else {
            const client = new OpenAI({ apiKey: config.apiKey });
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [
                    { role: 'system', content: config.prompt },
                    { role: 'user', content: context }
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

    private async postFixer(text: string, critique: string, config: any, runId: number, iteration: number, lengthConstraint: string = ''): Promise<string> {
        let output = '';

        const context = `Original Text:\n${text}\n\nCritique to address:\n${critique}\n\n${lengthConstraint ? `MANDATORY CONSTRAINT: ${lengthConstraint}` : ''}`;

        if (config.apiKey && config.apiKey.startsWith('sk-ant')) {
            const anthropic = new Anthropic({ apiKey: config.apiKey });
            const response = await anthropic.messages.create({
                model: config.model,
                max_tokens: 4000,
                system: config.prompt,
                messages: [
                    { role: 'user', content: context }
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
            const result = await model.generateContent(context);
            output = result.response.text();
        } else {
            const client = new OpenAI({ apiKey: config.apiKey });
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [
                    { role: 'system', content: config.prompt },
                    { role: 'user', content: context }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" }
            });
            output = response.choices[0].message.content || text;
        }

        let finalPostText = output;
        let metadata = {};

        try {
            // Attempt to parse JSON output from Fixer
            let cleaned = output.trim();

            // Remove markdown code blocks if present
            cleaned = cleaned.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                // Attempt to fix common JSON issues (newlines in strings?) - Risky, rely on valid JSON first
                const parsed = JSON.parse(cleaned);

                if (parsed.updated_text) {
                    finalPostText = parsed.updated_text;
                    metadata = {
                        what_changed: parsed.what_changed,
                        practical_gain: parsed.practical_gain,
                        estimated_practicality_index: parsed.estimated_practicality_index
                    };
                }
            }
        } catch (e) {
            console.warn('[PostFixer] Failed to parse JSON, returning raw output.', e);
        }

        if (runId > 0) {
            await this.prisma.agentIteration.create({
                data: {
                    run_id: runId, iteration_number: iteration, agent_role: 'post_fixer',
                    input: `Critique: ${(critique || '').substring(0, 200)}...`,
                    output: output, // Save full JSON for debugging
                    // We could add a metadata column later if needed
                }
            }).catch(console.error);
        }
        return finalPostText;
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

    async refineTopics(projectId: number, theme: string, weekId: number, promptOverride?: string, count: number = 2, existingTopics: string[] = []): Promise<{ topics: { topic: string, category: string, tags: string[] }[], score: number }> {
        console.log(`[MultiAgent] Starting topic generation for theme: "${theme}", count: ${count}`);

        // Fetch comments
        const commentsContext = await commentService.getCommentsForContext(projectId, 'week', weekId);

        // Context construction
        let fullContext = commentsContext;
        if (existingTopics.length > 0) {
            fullContext += `\n\nALREADY GENERATED TOPICS (DO NOT DUPLICATE):\n${existingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
        }
        fullContext += `\n\nREQUIRED OUTPUT QUANTITY: ${count} topics.`;

        // 1. Create Run Log (Topics)
        let runLogId = 0;
        try {
            const runLog = await this.prisma.agentRun.create({
                data: { topic: `TOPICS: ${theme}` }
            });
            runLogId = runLog.id;
        } catch (e) { console.error('Failed to create run log', e); }

        // Creator
        let creatorPrompt = await this.getPrompt(projectId, this.KEY_TOPIC_CREATOR, this.DEFAULT_TOPIC_CREATOR_PROMPT);
        if (promptOverride) creatorPrompt = promptOverride;

        let currentTopicsJSON = await this.topicCreator(theme, creatorPrompt, runLogId, fullContext);

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

    private async topicCreator(theme: string, systemPrompt: string, runId: number, additionalContext: string = ''): Promise<string> {
        let userContent = `Theme: ${theme}`;
        if (additionalContext) {
            userContent += `\n\nUSER COMMENTS / REQUIREMENTS:\n${additionalContext}`;
        }

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
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
            if (!result.critique) result.critique = "No critique provided.";
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
                    input: `Critique: ${(critique || '').substring(0, 200)}...`,
                    output: output
                }
            }).catch(console.error);
        }
        return output;
    }
}

export default new MultiAgentService();
