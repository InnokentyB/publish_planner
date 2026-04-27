class RedditService {
    private async getAccessToken(config: any): Promise<string> {
        const clientId = config.client_id || process.env.REDDIT_CLIENT_ID;
        const clientSecret = config.client_secret || process.env.REDDIT_CLIENT_SECRET;
        const username = config.username || process.env.REDDIT_USERNAME;
        const password = config.password || process.env.REDDIT_PASSWORD;
        const userAgent = config.user_agent || process.env.REDDIT_USER_AGENT || 'ba-post-planner/1.0';

        if (!clientId || !clientSecret || !username || !password) {
            throw new Error('Missing Reddit credentials');
        }

        const body = new URLSearchParams({
            grant_type: 'password',
            username,
            password
        });

        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent
            },
            body: body.toString()
        });

        if (!response.ok) {
            throw new Error(`Reddit auth failed: ${await response.text()}`);
        }

        const data: any = await response.json();
        if (!data.access_token) {
            throw new Error('Reddit auth response did not include access_token');
        }

        return data.access_token;
    }

    async submitDiscussionPost(config: any, params: {
        subreddit: string;
        title: string;
        text: string;
    }) {
        const token = await this.getAccessToken(config);
        const userAgent = config.user_agent || process.env.REDDIT_USER_AGENT || 'ba-post-planner/1.0';

        const body = new URLSearchParams({
            api_type: 'json',
            kind: 'self',
            sr: params.subreddit.replace(/^r\//, ''),
            title: params.title,
            text: params.text,
            resubmit: 'true'
        });

        const response = await fetch('https://oauth.reddit.com/api/submit', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent
            },
            body: body.toString()
        });

        if (!response.ok) {
            throw new Error(`Reddit submit failed: ${await response.text()}`);
        }

        const data: any = await response.json();
        const errors = data?.json?.errors || [];
        if (errors.length > 0) {
            throw new Error(`Reddit submit errors: ${JSON.stringify(errors)}`);
        }

        const url = data?.json?.data?.url;
        const name = data?.json?.data?.name;
        return {
            url: url ? `https://www.reddit.com${url}` : null,
            name: name || null
        };
    }

    async getPostMetrics(postUrl: string) {
        const normalizedUrl = postUrl.endsWith('.json') ? postUrl : `${postUrl.replace(/\/$/, '')}.json`;
        const response = await fetch(normalizedUrl, {
            headers: {
                'User-Agent': process.env.REDDIT_USER_AGENT || 'ba-post-planner/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`Reddit metrics fetch failed: ${response.status}`);
        }

        const data: any = await response.json();
        const post = data?.[0]?.data?.children?.[0]?.data;
        if (!post) {
            return null;
        }

        return {
            score: post.score || 0,
            comments: post.num_comments || 0,
            upvote_ratio: post.upvote_ratio ?? null,
            removed: Boolean(post.removed_by_category),
            permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : postUrl,
            retrieved_at: new Date().toISOString()
        };
    }
}

export default new RedditService();
