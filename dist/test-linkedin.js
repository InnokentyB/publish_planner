"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const linkedin_service_1 = __importDefault(require("./services/linkedin.service"));
async function main() {
    console.log('Testing LinkedIn Service initialized...');
    // 1. Test Auth URL Generation
    const authUrl = linkedin_service_1.default.getAuthUrl(1);
    console.log('Generated Auth URL:', authUrl);
    if (!authUrl.includes('response_type=code') || !authUrl.includes('client_id=')) {
        console.error('Auth URL generation seems incorrect');
        process.exit(1);
    }
    console.log('LinkedIn Service test passed (Initialization & Auth URL). Full end-to-end testing requires a real browser OAuth flow and real token.');
}
main().catch(console.error);
