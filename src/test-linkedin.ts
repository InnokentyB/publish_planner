import { config } from 'dotenv';
config();

import linkedinService from './services/linkedin.service';

async function main() {
    console.log('Testing LinkedIn Service initialized...');
    
    // 1. Test Auth URL Generation
    const authUrl = linkedinService.getAuthUrl(1);
    console.log('Generated Auth URL:', authUrl);
    
    if (!authUrl.includes('response_type=code') || !authUrl.includes('client_id=')) {
        console.error('Auth URL generation seems incorrect');
        process.exit(1);
    }
    
    console.log('LinkedIn Service test passed (Initialization & Auth URL). Full end-to-end testing requires a real browser OAuth flow and real token.');
}

main().catch(console.error);
