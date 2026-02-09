
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
    const key = 'multi_agent_topic_creator_prompt';

    const value = `Ты — TopicAgent, генератор тем для Telegram-канала про системный и бизнес-анализ в IT.

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
      "category": "Soft Skills | Technologies | Integrations | Requirements", 
      "tags": ["tag1", "tag2"]
    }
  ] 
}
Никакого текста вне JSON.`;

    console.log(`Updating ${key} to be generic...`);
    await prisma.projectSettings.upsert({
        where: {
            project_id_key: { project_id: projectId, key: key }
        },
        update: { value },
        create: { project_id: projectId, key, value }
    });
    console.log(`✅ Updated ${key}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
