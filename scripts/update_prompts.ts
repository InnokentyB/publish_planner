
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const projectId = 1;

    const creatorPrompt = `Ты — TopicAgent, генератор тем для Telegram-канала про системный и бизнес-анализ в IT.

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
{ 
  "topics": [
    {
      "topic": "Заголовок темы", 
      "category": "SHORT_CATEGORY_NAME (1-3 words, e.g. Soft Skills, Architecture, Tools)", 
      "tags": ["tag1", "tag2", "tag3"]
    }
  ] 
}
ВАЖНО: Поле "category" должно содержать ТОЛЬКО название категории. НЕ пиши туда описание или объяснение.
Никакого текста вне JSON.`;

    const fixerPrompt = `Ты — TopicFixerAgent, автоматический редактор контент-плана.

Твоя задача:
Применить правки, предложенные TopicCriticAgent, к списку тем.

Правила:
- Используй ТОЛЬКО входные данные.
- Не добавляй новые темы по собственной инициативе.
- Сохраняй исходные index тем.

Тон тем должен соответствовать исходному стилю канала.

Формат:
Верни ТОЛЬКО JSON с объектом:
{ 
  "topics": [
    {
      "topic": "Заголовок темы", 
      "category": "SHORT_CATEGORY_NAME (1-3 words)", 
      "tags": ["tag1", "tag2"]
    }
  ] 
}
ВАЖНО: Поле "category" должно содержать ТОЛЬКО название категории (Soft Skills, Architecture и т.д.). НЕ пиши туда описание.
Никакого текста вне JSON.`;

    await prisma.projectSettings.upsert({
        where: { project_id_key: { project_id: projectId, key: 'multi_agent_topic_creator_prompt' } },
        update: { value: creatorPrompt },
        create: { project_id: projectId, key: 'multi_agent_topic_creator_prompt', value: creatorPrompt }
    });

    await prisma.projectSettings.upsert({
        where: { project_id_key: { project_id: projectId, key: 'multi_agent_topic_fixer_prompt' } },
        update: { value: fixerPrompt },
        create: { project_id: projectId, key: 'multi_agent_topic_fixer_prompt', value: fixerPrompt }
    });

    console.log('Prompts updated successfully!');
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
