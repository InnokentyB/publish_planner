const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN = jwt.sign({ id: 1, email: 'admin@example.com' }, JWT_SECRET);
const PROJECT_ID = 1;
const POST_ID = 30;

async function run() {
    console.log(`Requesting Image Generation for Post ${POST_ID}...`);
    try {
        const res = await axios.post(`http://localhost:3003/api/posts/${POST_ID}/generate-image`, {
            provider: 'dalle'
        }, {
            headers: { 'Authorization': `Bearer ${TOKEN}`, 'x-project-id': PROJECT_ID }
        });
        console.log('Success:', res.data);
    } catch (error) {
        if (error.response) {
            console.log('Error Status:', error.response.status);
            console.log('Error Data:', error.response.data);
        } else {
            console.log('Error:', error.message);
        }
    }
}

run();
