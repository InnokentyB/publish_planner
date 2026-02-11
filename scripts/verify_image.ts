
import generatorService from '../src/services/generator.service';
import fs from 'fs';
import path from 'path';

async function testDownload() {
    const testUrl = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_light_color_272x92dp.png';
    const filename = 'test-image.png';

    console.log('Testing downloadAndSaveImage...');
    try {
        // We need to access the private method or create a public wrapper? 
        // Actually, let's just use the logic directly or cast to any to access private method.
        // Better: add a public test method or just assume if I can import it.
        // TypeScript might complain about private method.
        // Let's us (generatorService as any).downloadAndSaveImage

        const localPath = await (generatorService as any).downloadAndSaveImage(testUrl, filename);
        console.log('Success! Saved to:', localPath);

        // Verify file exists
        const fullPath = path.join(__dirname, '../uploads', filename);
        if (fs.existsSync(fullPath)) {
            console.log('File validated on disk.');
        } else {
            console.error('File not found on disk!');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

testDownload();
