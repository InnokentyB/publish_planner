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
exports.ExporterService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("@prisma/client");
const dotenv_1 = require("dotenv");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class ExporterService {
    constructor() {
        this.exportDir = path.join(__dirname, '../../exports');
        if (!fs.existsSync(this.exportDir)) {
            fs.mkdirSync(this.exportDir, { recursive: true });
        }
    }
    /**
     * Exports a ContentItem to a Markdown file.
     * Use this for habr_article, vc_article, zen_article, video_script.
     */
    async exportToMarkdown(contentItemId) {
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
${(item.key_points || []).map(kp => `- ${kp}`).join('\n')}

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
exports.ExporterService = ExporterService;
exports.default = new ExporterService();
