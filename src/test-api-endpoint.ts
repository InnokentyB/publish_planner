
import authService from './services/auth.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

// Setup Prisma for auth check just in case, but authService might need it
// Actually authService imports prisma internally, we just need to use it.

async function main() {
    // 1. Generate Token
    const user = { id: 1, email: 'i.a.bodrov85@gmail.com', name: 'User' };
    // @ts-ignore
    const token = authService.generateToken(user);
    console.log('Generated Token:', token);

    // 2. Make Request
    const response = await fetch('http://localhost:3000/api/weeks/1/generate-topics', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'x-project-id': '1'
        },
        body: JSON.stringify({})
    });

    console.log('Response Status:', response.status);
    const text = await response.text();
    console.log('Response Body:', text);
}

main();
