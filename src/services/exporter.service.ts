import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

config();
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class ExporterService {
    private exportDir = path.join(__dirname, '../../exports');

    constructor() {
        if (!fs.existsSync(this.exportDir)) {
            fs.mkdirSync(this.exportDir, { recursive: true });
        }
    }

    /**
     * Exports a ContentItem to a Markdown file.
     * Use this for habr_article, vc_article, zen_article, video_script.
     */
    async exportToMarkdown(contentItemId: number): Promise<string> {
        const item = await prisma.contentItem.findUnique({
            where: { id: contentItemId },
            include: { week_package: true }
        });

        if (!item) {
            throw new Error(`ContentItem ${contentItemId} not found for export.`);
        }

        const safeTitle = (item.title || `item_${item.id}`).replace(/[^a-z0-9а-яё]/gi, '_').toLowerCase();
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${dateStr}_${item.type}_${safeTitle}.md`;
        const filePath = path.join(this.exportDir, filename);

        const content = `---
type: ${item.type}
layer: ${item.layer || 'general'}
status: ${item.status}
week_theme: ${item.week_package?.week_theme || 'N/A'}
---

# ${item.title || 'Untitled'}

**Brief / Hook:**
${item.brief || ''}

**Key Points:**
${(item.key_points as string[] || []).map(kp => `- ${kp}`).join('\n')}

---

${item.draft_text || '*No text generated yet.*'}

---
**CTA:** ${item.cta || ''}
`;

        fs.writeFileSync(filePath, content, 'utf8');

        // Update status to 'published' in our terminology for exported drafts
        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: 'published',
                published_link: `file://${filePath}`
            }
        });

        console.log(`[Exporter] Successfully exported ${item.type} to ${filePath}`);
        return filePath;
    }
}

export default new ExporterService();
