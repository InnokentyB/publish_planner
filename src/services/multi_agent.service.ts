import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import prisma from '../db';
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
    private openai?: OpenAI;
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

    // Keys for Image Agent Chain
    public readonly KEY_VISUAL_ARCHITECT_PROMPT = 'visual_architect_prompt';
    public readonly KEY_VISUAL_ARCHITECT_KEY = 'visual_architect_key';
    public readonly KEY_VISUAL_ARCHITECT_MODEL = 'visual_architect_model';

    public readonly KEY_STRUCTURAL_CRITIC_PROMPT = 'structural_critic_prompt';
    public readonly KEY_STRUCTURAL_CRITIC_KEY = 'structural_critic_key';
    public readonly KEY_STRUCTURAL_CRITIC_MODEL = 'structural_critic_model';

    public readonly KEY_PRECISION_FIXER_PROMPT = 'precision_fixer_prompt';
    public readonly KEY_PRECISION_FIXER_KEY = 'precision_fixer_key';
    public readonly KEY_PRECISION_FIXER_MODEL = 'precision_fixer_model';

    // Default Prompts for Image Chain
    public readonly DEFAULT_VISUAL_ARCHITECT_PROMPT = "You are a Visual Architect. Your goal is to analyze the text, identify the core architectural conflict, select a single metaphor, and propose a rough scene. You MUST NOT generate the final prompt. Output ONLY a JSON object with keys: 'conflict', 'metaphor', 'scene_concept'.";
    public readonly DEFAULT_STRUCTURAL_CRITIC_PROMPT = "You are a Structural Critic. Analyze the provided scene concept. Check for: 1) Dominant conflict, 2) Causal link, 3) Abstraction level (should not be too abstract), 4) Dynamics. valid categories: Opinion, Education, Critique. Output ONLY a JSON object with keys: 'critique', 'weaknesses' (array of strings), 'score' (1-10).";
    public readonly DEFAULT_PRECISION_FIXER_PROMPT = "You are a Precision Fixer. Take the original concept and the critic's feedback. Rewrite the scene to: 1) Remove abstraction, 2) Strengthen conflict, 3) Improve readability, 4) Add engineering details. Output ONLY the raw final image prompt for DALL-E/Midjourney. Do not add markdown or labels.";

    // Keys for Sequential Generation Agents (Week Memory)
    public readonly KEY_SEQ_WRITER_PROMPT = 'multi_agent_seq_writer_prompt';
    public readonly KEY_SEQ_WRITER_KEY = 'multi_agent_seq_writer_key';
    public readonly KEY_SEQ_WRITER_MODEL = 'multi_agent_seq_writer_model';

    public readonly KEY_SEQ_CRITIC_PROMPT = 'multi_agent_seq_critic_prompt';
    public readonly KEY_SEQ_CRITIC_KEY = 'multi_agent_seq_critic_key';
    public readonly KEY_SEQ_CRITIC_MODEL = 'multi_agent_seq_critic_model';

    public readonly KEY_SEQ_FIXER_PROMPT = 'multi_agent_seq_fixer_prompt';
    public readonly KEY_SEQ_FIXER_KEY = 'multi_agent_seq_fixer_key';
    public readonly KEY_SEQ_FIXER_MODEL = 'multi_agent_seq_fixer_model';

    // Default Sequential Prompts
    private readonly DEFAULT_SEQ_WRITER_PROMPT = `You are a professional Content Writer based on context and memory.
Your goal is to write a Telegram post that fits into a weekly narrative.

Input Constraint:
- You receive the week's theme, specific topic, and "Week Memory" (what has been covered).
- You MUST NOT repeat "banned takeaways".
- You MUST try to use a different "angle" and "tool" than recently used.

Output JSON Format (Strict):
{
  "title": "...",
  "text": "...",
  "core_takeaway": "...",
  "key_points": ["...", "..."],
  "tool_used": "...",
  "angle": "...",
  "cta_question": "...",
  "hashtags": ["..."]
}

Definitions:
- core_takeaway: 1 sentence summary of the main value.
- tool_used: checklist / 3 questions / framework / case study / personal story / rant.
- angle: contrarian / analytical / emotional / educational.

Language: Russian (text), English (keys in JSON).`;

    private readonly DEFAULT_SEQ_CRITIC_PROMPT = `You are a strict Content Critic.
Review the provided post against the "Week Memory".

Criteria:
1. Is the "core_takeaway" unique? (Check banned_takeaways).
2. Is the content high value, no fluff?
3. Is the "tool_used" different from immediately previous posts?
4. Is the tone professional yet engaging?

Output JSON Format:
{
  "score": 0-100,
  "critique": "Specific feedback in Russian..."
}`;

    private readonly DEFAULT_SEQ_FIXER_PROMPT = `You are a Content Editor (Fixer).
Rewrite the post based on the critique. 
Maintain the JSON structure.
Ensure "core_takeaway" is distinct.

Output JSON Format (Strict):
{
  "title": "...",
  "text": "...",
  "core_takeaway": "...",
  "key_points": ["...", "..."],
  "tool_used": "...",
  "angle": "...",
  "cta_question": "...",
  "hashtags": ["..."]
}`;

    /**
     * Run Sequential Writer
     */
    async runSequentialWriter(projectId: number, context: any): Promise<any> {
        return this.runJsonAgent(projectId, 'seq_writer', this.KEY_SEQ_WRITER_PROMPT, this.DEFAULT_SEQ_WRITER_PROMPT, JSON.stringify(context));
    }

    /**
     * Run Content Critic
     */
    async runContentCritic(projectId: number, context: any): Promise<{ score: number, critique: string }> {
        const result = await this.runJsonAgent(projectId, 'seq_critic', this.KEY_SEQ_CRITIC_PROMPT, this.DEFAULT_SEQ_CRITIC_PROMPT, JSON.stringify(context));
        return {
            score: result?.score || 0,
            critique: result?.critique || "Parsing error"
        };
    }

    /**
     * Run Content Fixer
     */
    async runContentFixer(projectId: number, context: any): Promise<any> {
        return this.runJsonAgent(projectId, 'seq_fixer', this.KEY_SEQ_FIXER_PROMPT, this.DEFAULT_SEQ_FIXER_PROMPT, JSON.stringify(context));
    }

    /**
     * Generic JSON Agent Runner
     */
    private async runJsonAgent(projectId: number, role: string, promptKey: string, defaultPrompt: string, input: string): Promise<any> {
        const config = await this.getAgentConfig(projectId, role as any); // cast for now
        const systemPrompt = config.prompt || defaultPrompt;

        let responseText = '';

        if (!this.openai) throw new Error("OpenAI not initialized");

        try {
            const completion = await this.openai.chat.completions.create({
                model: config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: input }
                ],
                response_format: { type: 'json_object' }
            });

            responseText = completion.choices[0].message.content || '{}';

            // Log run
            await this.logRun(projectId, 'seq_gen', role, 'success', input, systemPrompt, responseText, null);

            return JSON.parse(responseText);

        } catch (error: any) {
            console.error(`[MultiAgent] ${role} failed:`, error);
            await this.logRun(projectId, 'seq_gen', role, 'failed', input, systemPrompt, '', error.message);
            return null;
        }
    }

    constructor() {
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
        }
        this.prisma = prisma;
    }

    private async logRun(projectId: number, type: string, agentRole: string | null, status: 'success' | 'failed', input: string | null, prompt: string | null, output: string | null, error: string | null) {
        try {
            await this.prisma.agentRun.create({
                data: {
                    project: { connect: { id: projectId } },
                    type,
                    agent_role: agentRole,
                    status,
                    input: input ? input.substring(0, 5000) : null,
                    prompt: prompt ? prompt.substring(0, 5000) : null,
                    output: output ? output.substring(0, 5000) : null,
                    error: error ? error.substring(0, 5000) : null
                }
            });
        } catch (e) {
            console.error('Failed to log agent run', e);
        }
    }

    // ... existing methods (need to be updated to use logRun) ...
    // I will update them one by one or in blocks to avoid huge replacement

    public async runImagePromptingChain(projectId: number, postText: string, topic: string): Promise<string> {
        console.log(`[MultiAgent] Running Image Chain for project ${projectId}`);

        // 1. Visual Architect
        const archInput = `Topic: ${topic}\n\nKey Text Context:\n${postText.substring(0, 500)}...`;

        let concept = await this.runJsonAgent(projectId, 'visual_architect', this.KEY_VISUAL_ARCHITECT_PROMPT, this.DEFAULT_VISUAL_ARCHITECT_PROMPT, archInput);

        // Fallback if Architect fails
        if (!concept || !concept.scene_concept) {
            console.warn('[MultiAgent] Visual Architect failed or returned invalid JSON. Using fallback.');
            return `A professional, high-quality, abstract illustration about: ${topic}. Minimalist style, corporate tech colors.`;
        }

        console.log('[MultiAgent] Visual Architect Concept:', concept.scene_concept.substring(0, 50));

        // 2. Structural Critic
        const criticInput = `Scene Concept: ${concept.scene_concept}`;
        let critique = await this.runJsonAgent(projectId, 'structural_critic', this.KEY_STRUCTURAL_CRITIC_PROMPT, this.DEFAULT_STRUCTURAL_CRITIC_PROMPT, criticInput);

        console.log('[MultiAgent] Structural Critic Score:', critique?.score);

        // 3. Precision Fixer (Final Prompt)
        const fixerInput = `Original Concept: ${concept.scene_concept}\nCritique: ${critique?.critique || 'No critique'}`;

        // Precision Fixer returns a STRING (Raw Prompt), not JSON usually, but let's check input/output format
        // The default prompt says: "Output ONLY the raw final image prompt"
        // So runJsonAgent might be wrong if it expects JSON. 
        // Let's use a generic runTextAgent for this or handle it.

        // Let's create a runTextAgent helper if not exists, or just manually call getAgentConfig + openai
        const fixerConfig = await this.getAgentConfig(projectId, 'precision_fixer');
        const systemPrompt = fixerConfig.prompt || this.DEFAULT_PRECISION_FIXER_PROMPT;

        try {
            if (!this.openai) throw new Error("OpenAI not initialized");
            const response = await this.openai.chat.completions.create({
                model: fixerConfig.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fixerInput }
                ],
                temperature: 0.7
            });

            const finalPrompt = response.choices[0].message.content || '';

            await this.logRun(projectId, 'image_chain', 'precision_fixer', 'success', fixerInput, systemPrompt, finalPrompt, null);

            // Clean up prompt (remove quotes if added by LLM)
            return finalPrompt.replace(/^"|"$/g, '').trim() || `Illustration about ${topic}`;

        } catch (e: any) {
            console.error('[MultiAgent] Precision Fixer failed:', e);
            await this.logRun(projectId, 'image_chain', 'precision_fixer', 'failed', fixerInput, systemPrompt, null, e.message);
            return concept.scene_concept; // Fallback to raw ID
        }
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
            console.error(`Failed to fetch prompt for ${key} in project ${projectId} `, e);
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
        } else if (rolePrefix === 'visual_architect') {
            apiKeyKey = this.KEY_VISUAL_ARCHITECT_KEY;
            modelKey = this.KEY_VISUAL_ARCHITECT_MODEL;
            promptKey = this.KEY_VISUAL_ARCHITECT_PROMPT;
            defaultPrompt = this.DEFAULT_VISUAL_ARCHITECT_PROMPT;
        } else if (rolePrefix === 'structural_critic') {
            apiKeyKey = this.KEY_STRUCTURAL_CRITIC_KEY;
            modelKey = this.KEY_STRUCTURAL_CRITIC_MODEL;
            promptKey = this.KEY_STRUCTURAL_CRITIC_PROMPT;
            defaultPrompt = this.DEFAULT_STRUCTURAL_CRITIC_PROMPT;
        } else if (rolePrefix === 'precision_fixer') {
            apiKeyKey = this.KEY_PRECISION_FIXER_KEY;
            modelKey = this.KEY_PRECISION_FIXER_MODEL;
            promptKey = this.KEY_PRECISION_FIXER_PROMPT;
            defaultPrompt = this.DEFAULT_PRECISION_FIXER_PROMPT;
        } else if (rolePrefix === 'seq_writer') {
            apiKeyKey = ''; // No specific key for now, use default
            modelKey = '';
            promptKey = this.KEY_SEQ_WRITER_PROMPT;
            defaultPrompt = this.DEFAULT_SEQ_WRITER_PROMPT;
        } else if (rolePrefix === 'seq_critic') {
            apiKeyKey = '';
            modelKey = '';
            promptKey = this.KEY_SEQ_CRITIC_PROMPT;
            defaultPrompt = this.DEFAULT_SEQ_CRITIC_PROMPT;
        } else if (rolePrefix === 'seq_fixer') {
            apiKeyKey = '';
            modelKey = '';
            promptKey = this.KEY_SEQ_FIXER_PROMPT;
            defaultPrompt = this.DEFAULT_SEQ_FIXER_PROMPT;
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
        console.log(`[MultiAgent Post] Starting generation for: "${topic}"(Image: ${withImage})`);

        // Fetch comments for context
        let commentsContext = await commentService.getCommentsForContext(projectId, 'post', postId);
        if (commentsContext) {
            console.log(`[MultiAgent Post] Found comments: ${commentsContext.length} chars`);
        } else {
            commentsContext = '';
        }

        // Define Strict Constraints
        let lengthConstraint = "";

        // With MTProto migration, we can handle longer captions (up to 2048 chars if premium, or just text splitting).
        // However, standard caption limit is 1024 without premium. 
        // Let's set a safe target of ~1000 for single caption or allow up to 2000 if we assume premium account/features.
        // Given the request for "picture + long text", we should aim for ~1500-2000 chars and trust the publisher to split/handle it 
        // OR rely on premium limits. 
        // SAFE BET: Target 1000-1100. If we really want long text, we might need to send image + text as separate messages 
        // or rely on the client splitting logic we implemented (which sends photo then text remainder).

        if (withImage) {
            // Unified approach: Always target long, detailed posts (2000+ chars).
            // MTProto will handle splitting if needed, or send as long caption if supported.
            lengthConstraint = "LIMIT: Target length is 2000-2500 characters. Max 4000. Ensure deep coverage of the topic. Do NOT shorten the text just because there is an image.";
        } else {
            lengthConstraint = "LIMIT: Target length is 2000-2500 characters. Max 4000. Ensure deep coverage of the topic, do not be too brief.";
        }

        // Add to creator context
        commentsContext += `\n\n[CONSTRAINT]: ${lengthConstraint} `;

        let runLogId = 0;
        try {
            const runLog = await this.prisma.agentRun.create({
                data: {
                    project: { connect: { id: projectId } },
                    type: 'post_gen_loop',
                    status: 'running',
                    input: `Topic: ${topic} `
                }
            });
            runLogId = runLog.id;
        } catch (e) { console.error('Failed to create run log', e); }

        let currentText = '';
        let currentScore = 0;
        let iterations = 0;
        const history: any[] = [];
        let category: string | undefined;
        let tags: string[] | undefined;

        try {
            const creatorConfig = await this.getAgentConfig(projectId, 'post_creator');
            if (promptOverride) {
                creatorConfig.prompt = promptOverride;
                console.log('[MultiAgent Post] Using prompt override');
            }

            currentText = await this.postCreator(theme, topic, creatorConfig, runLogId, commentsContext);

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

                console.log(`[MultiAgent Post]Iteration ${iterations} score: ${currentScore} `);

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
            try {
                console.log('[MultiAgent Post] Running Classifier...');
                const classifierConfig = await this.getAgentConfig(projectId, this.KEY_POST_CLASSIFIER);
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

            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: {
                            status: 'success',
                            output: currentText.substring(0, 5000),
                            final_score: currentScore,
                            total_iterations: iterations
                        }
                    });
                } catch (e) { console.error('Failed to finalize run log', e); }
            }
        } catch (error: any) {
            console.error('[MultiAgent Post] Fatal Error in loop:', error);
            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: {
                            status: 'failed',
                            error: error.message || 'Unknown error',
                            final_score: currentScore,
                            total_iterations: iterations
                        }
                    });
                } catch (e) { }
            }
            throw error;
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

        if (!this.openai) return { category: '', tags: [] };

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o', // Force JSON capable model
            messages: [
                { role: 'system', content: config.prompt || this.DEFAULT_POST_CLASSIFIER_PROMPT },
                { role: 'user', content: `Post Content: \n${text} ` }
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

        let userContent = `Theme: ${theme} \nPost Topic: ${topic} `;
        if (additionalContext) {
            userContent += `\n\nUSER COMMENTS / REQUIREMENTS: \n${additionalContext} `;
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

        const context = `Topic: ${topic} \n\nPost to evaluate: \n${text} \n\n${lengthConstraint ? `CRITICAL CONSTRAINT TO VERIFY: ${lengthConstraint}. If text exceeds limit, SCORE MUST BE < 50 and critique must demand shortening.` : ''} `;

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

        const context = `Original Text: \n${text} \n\nCritique to address: \n${critique} \n\n${lengthConstraint ? `MANDATORY CONSTRAINT: ${lengthConstraint}` : ''} `;

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
            cleaned = cleaned.replace(/^```json\s * /, '').replace(/ ^ ```\s*/, '').replace(/\s*```$ /, '');

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
        const fs = require('fs');
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Starting topic generation for theme: "${theme}", count: ${count}\n`);
        console.log(`[MultiAgent] Starting topic generation for theme: "${theme}", count: ${count}`);

        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Fetching comments...\n`);
        // Fetch comments
        const commentsContext = await commentService.getCommentsForContext(projectId, 'week', weekId);
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Comments fetched. Context length: ${commentsContext.length}\n`);

        // Context construction
        let fullContext = commentsContext;
        if (existingTopics.length > 0) {
            fullContext += `\n\nALREADY GENERATED TOPICS (DO NOT DUPLICATE):\n${existingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
        }
        fullContext += `\n\nREQUIRED OUTPUT QUANTITY: ${count} topics.`;

        // 1. Create Run Log (Topics)
        let runLogId = 0;
        try {
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Creating Run Log...\n`);
            const runLog = await this.prisma.agentRun.create({
                data: {
                    project: { connect: { id: projectId } },
                    type: 'topic_gen_loop',
                    status: 'running',
                    input: `Theme: ${theme}`
                }
            });
            runLogId = runLog.id;
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Run Log Created: ${runLogId}\n`);
        } catch (e) {
            console.error('Failed to create run log', e);
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Run Log Creation Failed: ${e}\n`);
        }

        // Initialize Agents
        if (!this.openai) throw new Error('OpenAI client not initialized (Missing API Key)');

        let currentTopicsJSON = '{}';
        let currentScore = 0;
        let iterations = 0;
        const MAX_ITERATIONS = 3;
        const TARGET_SCORE = 80; // Changed from 90 to 80

        try {
            // Creator
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Fetching Creator Prompt...\n`);
            let creatorPrompt = await this.getPrompt(projectId, this.KEY_TOPIC_CREATOR, this.DEFAULT_TOPIC_CREATOR_PROMPT);
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Creator Prompt fetched.\n`);

            if (promptOverride) creatorPrompt = promptOverride;

            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent] Calling Validated Topic Creator...\n`);
            currentTopicsJSON = await this.topicCreator(theme, creatorPrompt, runLogId, fullContext);

            // Ensure it's valid JSON structure from the start
            try {
                const parsed = JSON.parse(currentTopicsJSON);
                if (!parsed.topics && Array.isArray(parsed)) {
                    // Handle raw array return by wrapping it
                    currentTopicsJSON = JSON.stringify({ topics: parsed });
                }
            } catch (e) { }

            while (iterations < MAX_ITERATIONS) {
                iterations++;
                fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [MultiAgent Topics] Iteration ${iterations} starting...\n`);
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
                    currentTopicsJSON = await this.topicFixer(currentTopicsJSON, critiqueResult.critique, theme, fixerPrompt, runLogId, iterations);
                }
            }

            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: {
                            status: 'success',
                            output: currentTopicsJSON.substring(0, 5000),
                            final_score: currentScore,
                            total_iterations: iterations
                        }
                    });
                } catch (e) { console.error('Failed to finalize run log', e); }
            }
        } catch (error: any) {
            console.error('[MultiAgent Topics] Fatal Error in loop:', error);
            if (runLogId > 0) {
                try {
                    await this.prisma.agentRun.update({
                        where: { id: runLogId },
                        data: {
                            status: 'failed',
                            error: error.message || 'Unknown error',
                            final_score: currentScore,
                            total_iterations: iterations
                        }
                    });
                } catch (e) { }
            }
            throw error;
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
        const fs = require('fs');
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCreator] Starting... Theme: ${theme}\n`);

        if (!this.openai) throw new Error('OpenAI client not initialized (Missing API Key)');

        let userContent = `Theme: ${theme}`;
        if (additionalContext) {
            userContent += `\n\nUSER COMMENTS / REQUIREMENTS:\n${additionalContext}`;
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" }
            });
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCreator] OpenAI response received.\n`);

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
                } catch (e) { console.error('Log error', e); fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCreator] DB Log Error: ${e}\n`); }
            }
            return output;
        } catch (error: any) {
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCreator] ERROR: ${error.message}\n`);
            throw error;
        }
    }

    private async topicCritic(topicsJSON: string, theme: string, systemPrompt: string, runId: number, iteration: number): Promise<CritiqueResult> {
        const fs = require('fs');
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCritic] Starting Iteration ${iteration}...\n`);

        if (!this.openai) throw new Error('OpenAI client not initialized (Missing API Key)');

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Theme: ${theme}\n\nTopics JSON:\n${topicsJSON}` }
                ],
                response_format: { type: "json_object" },
                temperature: 0.3
            });
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCritic] OpenAI response received.\n`);

            let result: CritiqueResult;
            try {
                const content = response.choices[0].message.content || '{}';
                result = JSON.parse(content) as CritiqueResult;
                if (!result.critique) result.critique = "No critique provided.";
            } catch (e) {
                result = { score: 50, critique: "Failed to parse critique." };
            }

            if (runId > 0) {
                try {
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
                    });
                } catch (e) { console.error('Log error', e); fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCritic] DB Log Error: ${e}\n`); }
            }
            return result;
        } catch (error: any) {
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicCritic] CRITICAL ERROR: ${error.message}\n`);
            throw error;
        }
    }

    private async topicFixer(topicsJSON: string, critique: string, theme: string, systemPrompt: string, runId: number, iteration: number): Promise<string> {
        const fs = require('fs');
        fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicFixer] Starting Iteration ${iteration}...\n`);

        if (!this.openai) throw new Error('OpenAI client not initialized (Missing API Key)');

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Original Topics:\n${topicsJSON}\n\nCritique:\n${critique}` }
                ],
                response_format: { type: "json_object" },
                temperature: 0.7
            });
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicFixer] OpenAI response received.\n`);

            const output = response.choices[0].message.content || topicsJSON;

            if (runId > 0) {
                try {
                    await this.prisma.agentIteration.create({
                        data: {
                            run_id: runId,
                            iteration_number: iteration,
                            agent_role: 'topic_fixer',
                            input: `Critique: ${(critique || '').substring(0, 200)}...`,
                            output: output
                        }
                    });
                } catch (e) { console.error('Log error', e); fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicFixer] DB Log Error: ${e}\n`); }
            }
            return output;
        } catch (error: any) {
            fs.appendFileSync('debug.log', `[${new Date().toISOString()}] [TopicFixer] CRITICAL ERROR: ${error.message}\n`);
            throw error;
        }
    }



}

export default new MultiAgentService();
