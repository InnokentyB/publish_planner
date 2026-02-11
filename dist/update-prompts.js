"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const projectId = 1; // Main Project
    const prompts = {
        'multi_agent_post_creator_prompt': `You are an expert content creator. Write an engaging, insightful, and professionally formatted Telegram post about the given topic. Use Markdown. Focus on value. Max 4000 chars. Language: Russian.`,
        'multi_agent_post_critic_prompt': `You are a strict editor. Evaluate the post based on relevance, insight, clarity, engagement, and formatting. Output JSON with "score" (0-100) and "critique" (in Russian).`,
        'multi_agent_post_fixer_prompt': `You are an expert editor. Rewrite the post to address the critique while keeping the original meaning. Language: Russian.
    
CRITICAL: Return ONLY the improved post text itself. Do NOT include:
- Any meta-commentary about what you changed
- Explanations of improvements
- Analysis of the critique
- Introductory phrases like "Here's the improved version" or "Замечательная работа"

Start directly with the post content.`,
        'multi_agent_topic_creator_prompt': `You are an expert content strategist. 
Generate 2 unique, engaging, and valuable topics for a tech Telegram channel based on the provided theme.
The content MUST be in Russian.

For each topic, provide:
- topic: The title/subject (in Russian)
- category: One of "Soft Skills", "Technologies", "Integrations", "Requirements"
- tags: 2-4 relevant tags (in Russian)

Return ONLY a JSON object with a "topics" property containing an array of objects.
Example: { "topics": [{"topic": "...", "category": "...", "tags": [...]}, ...] }`,
        'multi_agent_topic_critic_prompt': `You are a critical content strategist. Review the proposed list of 2 topics.
Critique based on:
1. Variety (are they all the same?)
2. Relevance to the theme
3. Engagement potential (are they boring?)
4. Balance of categories

Your output MUST be valid JSON:
{
    "score": <number 0-100>,
    "critique": "<detailed feedback in Russian>"
}`,
        'multi_agent_topic_fixer_prompt': `You are an expert content strategist. Fix the list of topics based on the critique.
Ensure there are exactly 2 topics.
The content MUST be in Russian.
Return ONLY a JSON object with a "topics" property containing an array of objects.`
    };
    console.log(`Updating prompts for Project ID ${projectId} to Russian...`);
    for (const [key, value] of Object.entries(prompts)) {
        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            },
            update: { value },
            create: {
                project_id: projectId,
                key,
                value
            }
        });
        console.log(`Updated ${key}`);
    }
    console.log('Done!');
    await prisma.$disconnect();
}
main();
