const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN = jwt.sign({ id: 1, email: 'admin@example.com' }, JWT_SECRET);
const PROJECT_ID = 1;
const WEEK_ID = 4;

async function run() {
    try {
        // 1. Get Week Posts
        console.log('Fetching week...');
        const weekRes = await axios.get(`http://localhost:3003/api/weeks/${WEEK_ID}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}`, 'x-project-id': PROJECT_ID }
        });
        const posts = weekRes.data.posts;
        if (!posts || posts.length === 0) {
            console.error('No posts found in week 4');
            return;
        }
        const postId = posts[0].id;
        console.log(`Found Post ID: ${postId}`);

        // 2. Generate Image
        console.log(`Requesting Image Generation for Post ${postId}...`);
        const res = await axios.post(`http://localhost:3003/api/posts/${postId}/generate-image`, {
            provider: 'dalle'
        }, {
            headers: { 'Authorization': `Bearer ${TOKEN}`, 'x-project-id': PROJECT_ID }
        });

        console.log('Success:', res.data);

    } catch (error) {
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

run();
