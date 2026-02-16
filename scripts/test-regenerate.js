const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN = jwt.sign({ id: 1, email: 'admin@example.com' }, JWT_SECRET);
const PROJECT_ID = 1;
const WEEK_ID = 4;

async function run() {
    console.log('Sending regenerate request...');
    try {
        const res = await axios.post(`http://127.0.0.1:3003/api/weeks/${WEEK_ID}/generate-topics`, {
            overwrite: true
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
                'x-project-id': PROJECT_ID
            },
            timeout: 120000 // 2 minutes
        });
        console.log('Success:', res.data);
    } catch (error) {
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Data:', error.response.data);
        } else if (error.request) {
            console.error('No response received:', error.message);
        } else {
            console.error('Error:', error.message);
        }
    }
}

run();
