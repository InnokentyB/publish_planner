
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

async function main() {
    // 1. Generate Token
    const token = jwt.sign({ id: 2, email: 'i.a.bodrov85@gmail.com', name: 'User' }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Call API
    const url = 'http://localhost:3000/api/weeks/2';
    console.log(`Calling ${url}...`);

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Body:', text);
    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

main();
