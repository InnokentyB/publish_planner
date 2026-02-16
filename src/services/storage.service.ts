import { supabase } from './supabase';
import fs from 'fs';
import path from 'path';

const BUCKET_NAME = 'post-images';

export class StorageService {
    /**
     * Ensures the bucket exists. If not, logs a warning (creating buckets programmatically requires service role key).
     */
    async ensureBucketExists() {
        const { data, error } = await supabase.storage.getBucket(BUCKET_NAME);
        if (error) {
            console.warn(`[Storage] Bucket '${BUCKET_NAME}' not found or not accessible. Ensure it exists in Supabase Dashboard.`);
            console.warn(`[Storage] Error details:`, error);
            // Attempt to create if we have permissions (likely fails with anon key, but worth a try if using service role)
            const { data: createData, error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
                public: true,
                fileSizeLimit: 10485760, // 10MB
                allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
            });
            if (createError) {
                console.error(`[Storage] Failed to create bucket '${BUCKET_NAME}':`, createError);
            } else {
                console.log(`[Storage] Created bucket '${BUCKET_NAME}'`);
            }
        } else {
            console.log(`[Storage] Bucket '${BUCKET_NAME}' exists.`);
        }
    }

    /**
   * Uploads a file from a buffer to Supabase Storage.
   * @param buffer File buffer
   * @param mimeType Mime type of the file
   * @param destinationPath Path in the bucket
   * @returns Public URL of the uploaded file
   */
    async uploadFileFromBuffer(buffer: Buffer, mimeType: string, destinationPath: string): Promise<string> {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(destinationPath, buffer, {
                    upsert: true,
                    contentType: mimeType
                });

            if (error) {
                throw error;
            }

            const { data: publicData } = supabase.storage
                .from(BUCKET_NAME)
                .getPublicUrl(destinationPath);

            return publicData.publicUrl;
        } catch (error) {
            console.error(`[Storage] Error uploading buffer:`, error);
            throw error;
        }
    }

    /**
     * Uploads a file from the local filesystem to Supabase Storage.
     * @param localPath Absolute path to the local file
     * @param destinationPath Path in the bucket (e.g., 'uploads/image.png')
     * @returns Public URL of the uploaded file
     */
    async uploadFile(localPath: string, destinationPath: string): Promise<string> {
        try {
            const fileContent = fs.readFileSync(localPath);
            return await this.uploadFileFromBuffer(fileContent, this.getContentType(localPath), destinationPath);
        } catch (error) {
            console.error(`[Storage] Error uploading file ${localPath}:`, error);
            throw error;
        }
    }

    /**
     * Deletes a file from Supabase Storage.
     * @param url Public URL or path of the file
     */
    async deleteFile(url: string): Promise<void> {
        try {
            // Extract path from URL if needed. 
            // URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
            let pathToRemove = url;
            if (url.includes(`/storage/v1/object/public/${BUCKET_NAME}/`)) {
                pathToRemove = url.split(`/storage/v1/object/public/${BUCKET_NAME}/`)[1];
            }

            const { error } = await supabase.storage
                .from(BUCKET_NAME)
                .remove([pathToRemove]);

            if (error) {
                console.error(`[Storage] Failed to delete file '${pathToRemove}':`, error);
                // Don't throw, just log. Cleanup failures shouldn't crash the app.
            } else {
                console.log(`[Storage] Deleted file '${pathToRemove}'`);
            }
        } catch (error) {
            console.error(`[Storage] Error deleting file ${url}:`, error);
        }
    }

    private getContentType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.png': return 'image/png';
            case '.jpg':
            case '.jpeg': return 'image/jpeg';
            case '.gif': return 'image/gif';
            case '.webp': return 'image/webp';
            default: return 'application/octet-stream';
        }
    }
}

export default new StorageService();
