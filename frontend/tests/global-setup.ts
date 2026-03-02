/**
 * Playwright Global Setup
 *
 * Runs once before the entire test suite.
 * Ensures a dedicated E2E test user exists in the DB by calling the
 * registration API. Idempotent: if the user already exists, the error
 * is safely swallowed.
 */
import { request } from '@playwright/test';

const API_URL = 'http://localhost:3003';
const TEST_EMAIL = process.env.TEST_EMAIL || 'e2e@ba-planner.test';
const TEST_PASS = process.env.TEST_PASS || 'e2e-test-password-123';
const TEST_NAME = 'E2E Test User';

async function globalSetup() {
    const ctx = await request.newContext();

    const res = await ctx.post(`${API_URL}/api/auth/register`, {
        data: { email: TEST_EMAIL, password: TEST_PASS, name: TEST_NAME }
    });

    if (res.ok()) {
        console.log(`[global-setup] Test user created: ${TEST_EMAIL}`);
    } else {
        const body = await res.json() as { error?: string };
        if (body.error && body.error.includes('already exists')) {
            console.log(`[global-setup] Test user already exists: ${TEST_EMAIL}`);
        } else {
            throw new Error(
                `[global-setup] Failed to register test user (${res.status()}): ${JSON.stringify(body)}`
            );
        }
    }

    await ctx.dispose();
}

export default globalSetup;
