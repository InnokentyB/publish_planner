"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LinkedInService {
    getClientId() {
        return process.env.LINKEDIN_CLIENT_ID || '';
    }
    getClientSecret() {
        return process.env.LINKEDIN_CLIENT_SECRET || '';
    }
    getRedirectUri() {
        const baseUrl = process.env.API_URL || 'http://localhost:3003';
        return `${baseUrl}/api/auth/linkedin/callback`;
    }
    /**
     * Generates the OAuth 2.0 Authorization URL for LinkedIn.
     * @param projectId The project ID to pass in state parameter
     */
    getAuthUrl(projectId) {
        const clientId = this.getClientId();
        const redirectUri = encodeURIComponent(this.getRedirectUri());
        const state = encodeURIComponent(JSON.stringify({ projectId }));
        // r_liteprofile was replaced by profile or r_basicprofile, and w_member_social/w_organization_social
        // Now it's typically "openid profile email w_member_social" for user accounts.
        // Let's request what's needed for member social posting.
        const scope = encodeURIComponent('w_member_social openid profile email');
        return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}`;
    }
    /**
     * Exchanges auth code for an access token.
     */
    async exchangeCodeToToken(code) {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        const redirectUri = this.getRedirectUri();
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LinkedIn token exchange failed: ${errorText}`);
        }
        const data = await response.json();
        return data.access_token;
    }
    /**
     * Fetches the user's profile info (URN and Name).
     * Uses the OpenID UserInfo endpoint if 'openid' scope was requested, or the v2/me endpoint.
     */
    async getUserProfile(token) {
        // v2/userinfo requires 'openid profile' scopes
        const response = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LinkedIn userinfo failed: ${errorText}`);
        }
        const data = await response.json();
        const urn = `urn:li:person:${data.sub}`; // 'sub' is the person URN identifier
        const name = `${data.given_name} ${data.family_name}`.trim();
        return { urn, name };
    }
    /**
     * Upload an image to LinkedIn using the Assets API
     */
    async uploadImage(urn, token, imageUrl) {
        // 1. Register Upload
        const registerBody = {
            registerUploadRequest: {
                recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                owner: urn,
                serviceRelationships: [
                    {
                        relationshipType: "OWNER",
                        identifier: "urn:li:userGeneratedContent"
                    }
                ]
            }
        };
        const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registerBody)
        });
        if (!registerRes.ok) {
            const errorText = await registerRes.text();
            throw new Error(`LinkedIn image register failed: ${errorText}`);
        }
        const registerData = await registerRes.json();
        const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
        const asset = registerData.value.asset;
        // 2. Fetch/Prepare Image
        let imageBuffer;
        if (imageUrl.startsWith('data:')) {
            const base64Data = imageUrl.split(',')[1];
            imageBuffer = Buffer.from(base64Data, 'base64');
        }
        else if (imageUrl.startsWith('/uploads/')) {
            const filename = imageUrl.split('/').pop();
            const localPath = path_1.default.join(__dirname, '../../uploads', filename || '');
            if (fs_1.default.existsSync(localPath)) {
                imageBuffer = fs_1.default.readFileSync(localPath);
            }
            else {
                throw new Error(`Local image file not found: ${localPath}`);
            }
        }
        else if (imageUrl.startsWith('http')) {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok)
                throw new Error(`Failed to fetch remote image: ${imgRes.statusText}`);
            const arrayBuffer = await imgRes.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
        }
        else {
            throw new Error(`Unsupported image format: ${imageUrl}`);
        }
        // 3. Upload Image Binary
        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
            // Let the proxy or fetch set Content-Length / Content-Type based on Buffer
            // If it fails, maybe 'Authorization' generic
            },
            body: new Uint8Array(imageBuffer)
        });
        if (!uploadRes.ok && uploadRes.status !== 201) {
            const errorText = await uploadRes.text();
            throw new Error(`LinkedIn image binary upload failed [${uploadRes.status}]: ${errorText}`);
        }
        return asset;
    }
    /**
     * Publishes a post to LinkedIn using the ugcPosts API.
     */
    async publishPost(urn, token, text, imageUrl) {
        let mediaAsset;
        if (imageUrl) {
            try {
                mediaAsset = await this.uploadImage(urn, token, imageUrl);
            }
            catch (err) {
                console.error('[LinkedInService] Image upload failed, falling back to text only', err);
            }
        }
        const postBody = {
            author: urn,
            lifecycleState: "PUBLISHED",
            specificContent: {
                "com.linkedin.ugc.ShareContent": {
                    shareCommentary: {
                        text: text
                    },
                    shareMediaCategory: mediaAsset ? "IMAGE" : "NONE",
                }
            },
            visibility: {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
            }
        };
        if (mediaAsset) {
            postBody.specificContent["com.linkedin.ugc.ShareContent"].media = [
                {
                    status: "READY",
                    description: {
                        text: "Image description"
                    },
                    media: mediaAsset
                }
            ];
        }
        const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0'
            },
            body: JSON.stringify(postBody)
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LinkedIn publish failed: ${errorText}`);
        }
        const data = await response.json();
        // Return LinkedIn activity URL or ID
        // The id is e.g. "urn:li:share:61231231231"
        const postIdStr = data.id || '';
        const numericIdMatch = postIdStr.match(/:(\d+)$/);
        if (numericIdMatch) {
            return `https://www.linkedin.com/feed/update/${postIdStr}`;
        }
        return `https://www.linkedin.com/`;
    }
    /**
     * Fetches metrics (likes, comments, views) for a given LinkedIn post.
     * @param urn The organization/person URN that owns the post
     * @param token The access token
     * @param postUrl The published post URL to extract the share URN from
     */
    async getMetrics(urn, token, postUrl) {
        // We need to extract the share urn from the saved published link.
        // e.g. https://www.linkedin.com/feed/update/urn:li:share:123456789
        // or https://www.linkedin.com/feed/update/urn:li:ugcPost:123456789
        const match = postUrl.match(/(urn:li:(share|ugcPost):\d+)/);
        if (!match) {
            console.error(`[LinkedInService] Could not parse URN from URL: ${postUrl}`);
            return null;
        }
        const shareUrn = match[1];
        try {
            // LinkedIn provides socialActions to get likes/comments count for a share
            const response = await fetch(`https://api.linkedin.com/v2/socialActions/${shareUrn}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restli-Protocol-Version': '2.0.0'
                }
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LinkedIn socialActions failed: ${response.status} ${errorText}`);
            }
            const data = await response.json();
            return {
                likes: data.likesSummary?.totalLikes || 0,
                comments: data.commentsSummary?.totalFirstDegreeComments || 0,
                // Views are only available via organizational page statistics API (networkSizes, organizationalEntityShareStatistics)
                // They aren't universally available for individual profiles via basic APIs.
                views: 0,
                reposts: 0,
                retrieved_at: new Date().toISOString()
            };
        }
        catch (err) {
            console.error(`[LinkedInService] Failed to get metrics for share ${shareUrn}:`, err);
            return null;
        }
    }
}
exports.default = new LinkedInService();
