"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vk_io_1 = require("vk-io");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class VKService {
    /**
     * Publishes a post to a VK community wall.
     * @param vkId The community/page ID (usually starts with '-' if it's a group, e.g., '-123456')
     * @param apiKey The community access token
     * @param text The text content of the post
     * @param imageUrl Optional image URL (local path or remote URL)
     * @returns The generated VK post URL (e.g., https://vk.com/wall-123456_789)
     */
    async publishPost(vkId, apiKey, text, imageUrl) {
        const vk = new vk_io_1.VK({
            token: apiKey
        });
        // Convert string vkId to number, removing any '-' prefix if the user included it or not.
        // VK wall.post owner_id requires negative number for communities.
        let ownerId = parseInt(vkId, 10);
        if (ownerId > 0) {
            // Assume it's a community ID that should be negative
            ownerId = -ownerId;
        }
        let attachmentString;
        if (imageUrl) {
            try {
                let photoSource;
                if (imageUrl.startsWith('data:')) {
                    const base64Data = imageUrl.split(',')[1];
                    photoSource = {
                        value: Buffer.from(base64Data, 'base64')
                    };
                }
                else if (imageUrl.startsWith('/uploads/')) {
                    const filename = imageUrl.split('/').pop();
                    const localPath = path_1.default.join(__dirname, '../../uploads', filename || '');
                    if (fs_1.default.existsSync(localPath)) {
                        photoSource = {
                            value: fs_1.default.createReadStream(localPath)
                        };
                    }
                    else {
                        throw new Error(`Local image file not found: ${localPath}`);
                    }
                }
                else if (imageUrl.startsWith('http')) {
                    // For remote URLs, vk-io upload.wallPhoto supports stream/buffer, so we fetch it first
                    const response = await fetch(imageUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch remote image: ${response.statusText}`);
                    }
                    const buffer = await response.arrayBuffer();
                    photoSource = {
                        value: Buffer.from(buffer)
                    };
                }
                else {
                    throw new Error(`Unsupported image URL format: ${imageUrl}`);
                }
                if (photoSource) {
                    // Upload photo to the wall
                    const photo = await vk.upload.wallPhoto({
                        source: photoSource,
                        group_id: Math.abs(ownerId) // upload.wallPhoto requires positive group_id
                    });
                    attachmentString = photo.toString(); // format: photo{owner_id}_{photo_id}
                }
            }
            catch (err) {
                console.error(`[VKService] Failed to upload image, falling back to text only:`, err);
            }
        }
        // Post to the wall
        const postParams = {
            owner_id: ownerId,
            message: text
        };
        if (attachmentString) {
            postParams.attachments = attachmentString;
        }
        const response = await vk.api.wall.post(postParams);
        // Construct the post URL
        return `https://vk.com/wall${ownerId}_${response.post_id}`;
    }
}
exports.default = new VKService();
