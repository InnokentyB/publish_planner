
import { PrismaClient } from '@prisma/client';
import multiAgentService from './multi_agent.service';
import publisherService from './publisher.service';
import prisma from '../db';

interface sequentialParams {
    projectId: number;
    weekId: number;
}

class SequentialWriterService {

    async generateWeekPosts(projectId: number, weekId: number) {
        console.log(`[SequentialWriter] Starting generation for week ${weekId}`);

        const week = await prisma.week.findUnique({
            where: { id: weekId },
            include: { posts: { orderBy: { slot_index: 'asc' } } }
        });

        if (!week) throw new Error("Week not found");

        // Initialize or Fetch Memory
        let memory = await prisma.weekMemory.findUnique({ where: { week_id: weekId } });
        if (!memory) {
            memory = await prisma.weekMemory.create({
                data: {
                    week_id: weekId,
                    week_core_summary: "",
                    covered_angles: [],
                    used_tools: [],
                    banned_takeaways: []
                }
            });
        }

        // We assume posts are already created as slots (14 slots) with topics (if topic planner ran).
        // If not, we might need to verify topic existence.
        // For this implementation, we iterate over existing posts in the week.

        const posts = week.posts;

        for (const post of posts) {
            if (post.status === 'published' || post.status === 'scheduled') {
                console.log(`[SequentialWriter] Skipping post ${post.id} (status: ${post.status})`);
                continue;
            }

            console.log(`[SequentialWriter] Generating content for post ${post.id} (Topic: ${post.topic})`);

            // 1. Prepare Context
            const context = {
                week_theme: week.theme,
                topic: post.topic || "General Industry Update",
                week_memory: {
                    core_summary: memory!.week_core_summary,
                    covered_angles: memory!.covered_angles,
                    used_tools: memory!.used_tools,
                    banned_takeaways: memory!.banned_takeaways
                }
            };

            // 2. Writer Agent
            const writerResult = await multiAgentService.runSequentialWriter(projectId, context);
            if (!writerResult) {
                console.error(`[SequentialWriter] Writer failed for post ${post.id}`);
                continue;
            }

            // 3. Critic Agent
            let currentContent = writerResult;
            let score = 0;
            let attempts = 0;
            const maxAttempts = 2;
            let approved = false;

            while (attempts <= maxAttempts && !approved) {
                const criticResult = await multiAgentService.runContentCritic(projectId, {
                    content: currentContent,
                    week_memory: context.week_memory
                });

                score = criticResult.score;

                if (score >= 80) {
                    approved = true;
                } else {
                    console.log(`[SequentialWriter] Critic score ${score}. Attempting fix...`);
                    // 4. Fixer Agent
                    const fixedContent = await multiAgentService.runContentFixer(projectId, {
                        content: currentContent,
                        critique: criticResult.critique,
                        week_memory: context.week_memory
                    });

                    if (fixedContent) {
                        currentContent = fixedContent;
                    }
                    attempts++;
                }
            }

            // 5. Save Post
            await prisma.post.update({
                where: { id: post.id },
                data: {
                    final_text: currentContent.text,
                    generated_text: currentContent.text,
                    core_takeaway: currentContent.core_takeaway,
                    key_points: currentContent.key_points || [],
                    tool_used: currentContent.tool_used,
                    angle: currentContent.angle,
                    critic_score: score,
                    status: score >= 75 ? 'generated' : 'draft' // Mark as draft if low score
                }
            });

            // 6. Update Memory
            await this.updateMemory(weekId, currentContent);

            // Reload memory for next iteration
            memory = await prisma.weekMemory.findUnique({ where: { week_id: weekId } });
        }

        console.log(`[SequentialWriter] Week ${weekId} generation complete.`);
    }

    private async updateMemory(weekId: number, content: any) {
        const memory = await prisma.weekMemory.findUnique({ where: { week_id: weekId } });
        if (!memory) return;

        const coveredAngles = (memory.covered_angles as string[]) || [];
        if (content.angle && !coveredAngles.includes(content.angle)) {
            coveredAngles.push(content.angle);
        }

        const usedTools = (memory.used_tools as string[]) || [];
        if (content.tool_used && !usedTools.includes(content.tool_used)) {
            usedTools.push(content.tool_used);
        }

        const bannedTakeaways = (memory.banned_takeaways as string[]) || [];
        if (content.core_takeaway) {
            bannedTakeaways.push(content.core_takeaway);
        }

        // Simple aggregation for summary - append latest takeaway
        const newSummary = (memory.week_core_summary ? memory.week_core_summary + " " : "") +
            `[Post: ${content.core_takeaway}]`;

        await prisma.weekMemory.update({
            where: { week_id: weekId },
            data: {
                covered_angles: coveredAngles,
                used_tools: usedTools,
                banned_takeaways: bannedTakeaways,
                week_core_summary: newSummary.slice(-1000) // Keep last 1000 chars to fit context
            }
        });
    }
}

export default new SequentialWriterService();
