import OpenAI from 'openai';
import { config } from 'dotenv';
config();
const openai = new OpenAI();
async function run() {
    try {
        await openai.images.generate({ prompt: "", model: "dall-e-3" });
    } catch(e: any) {
        console.log(e.message);
    }
}
run();
