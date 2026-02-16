import generatorService from '../src/services/generator.service';
import { config } from 'dotenv';
config();

async function main() {
    console.log('Testing Image Generation (DALL-E)...');
    try {
        const url = await generatorService.generateImage('A futuristic city with flying cars, digital art style');
        console.log('Success! Image URL:', url);
    } catch (e: any) {
        console.error('Failed to generate image:', e);
        if (e.response) {
            console.error('Response Data:', e.response.data);
        }
    }
}

main();
