
import storageService from '../src/services/storage.service';
import fs from 'fs';
import path from 'path';

async function testStorage() {
    console.log('Testing Storage Service...');
    const testFile = path.join(__dirname, 'test_image.txt');
    fs.writeFileSync(testFile, 'Hello Supabase Storage');

    try {
        console.log('Uploading file...');
        const url = await storageService.uploadFile(testFile, 'test_upload.txt');
        console.log('✅ Upload successful:', url);

        console.log('Deleting file...');
        await storageService.deleteFile(url);
        console.log('✅ Delete successful');

    } catch (e: any) {
        console.error('❌ Storage Test Failed:', e);
    } finally {
        fs.unlinkSync(testFile);
    }
}

testStorage();
