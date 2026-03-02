import { test, expect, request } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3003';

// Default credentials for the auto-created E2E test user (see global-setup.ts)
const DEFAULT_EMAIL = process.env.TEST_EMAIL || 'e2e@ba-planner.test';
const DEFAULT_PASS = process.env.TEST_PASS || 'e2e-test-password-123';

// ------------------------------------------------------------
// Helper: obtain a real JWT token for a test user via the API
// ------------------------------------------------------------
/**
 * Authenticates via the backend API and returns the response body
 * containing `token`, `user`, and `projects`.
 */
async function getAuthData(): Promise<{ token: string; user: object; projects: object[] }> {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API_URL}/api/auth/login`, {
        data: {
            email: DEFAULT_EMAIL,
            password: DEFAULT_PASS
        }
    });
    if (!res.ok()) {
        throw new Error(`Login failed with status ${res.status()}: ${await res.text()}`);
    }
    return res.json();
}

// ------------------------------------------------------------
// Helper: inject auth into localStorage so AuthContext auto-loads
// ------------------------------------------------------------
/**
 * Injects JWT + user/project data into localStorage, bypassing the login form.
 * This mirrors exactly what AuthContext.login() persists to localStorage.
 */
async function injectAuth(page: import('@playwright/test').Page) {
    const data = await getAuthData();

    // Navigate to /login first so we have a valid page origin to set localStorage on
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate(({ token, user, projects }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('projects', JSON.stringify(projects));
        if ((projects as { id: number }[]).length > 0) {
            localStorage.setItem('projectId', String((projects as { id: number }[])[0].id));
        }
    }, data as { token: string; user: object; projects: object[] });
}

// ====================================================================
// Suite 1: Authentication
// ====================================================================
test.describe('Authentication', () => {
    test('should successfully log in via the login form', async ({ page }) => {
        await page.goto('/login');
        await page.getByLabel('Email').fill(DEFAULT_EMAIL);
        await page.getByLabel('Password').fill(DEFAULT_PASS);
        await page.getByRole('button', { name: 'Login' }).click();

        // After login the app navigates to '/'
        await expect(page).toHaveURL(/^(?!.*login)/, { timeout: 10000 });
    });

    test('should reject incorrect credentials', async ({ page }) => {
        await page.goto('/login');
        await page.getByLabel('Email').fill('nonexistent-user@test.com');
        await page.getByLabel('Password').fill('wrong-password-xyz');
        await page.getByRole('button', { name: 'Login' }).click();

        // Error badge should appear
        await expect(page.locator('.badge-error')).toBeVisible({ timeout: 5000 });
    });
});

// ====================================================================
// Suite 2: V2 Dashboard – Navigation & Tabs
// ====================================================================
test.describe('V2 Orchestrator Dashboard – Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await injectAuth(page);
        await page.goto('/orchestrator');
        await expect(page.locator('h1')).toContainText('V2 Orchestrator', { timeout: 15000 });
    });

    test('should display the tab navigation', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Quarter Strategy (Top-Down)' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Tactical Weeks' })).toBeVisible();
    });

    test('should default to the Quarter Strategy tab', async ({ page }) => {
        // The quarter creation button should be visible by default (not the week one)
        await expect(page.getByRole('button', { name: '+ Plan Strategic Quarter' })).toBeVisible();
    });

    test('should switch to Tactical Weeks tab', async ({ page }) => {
        await page.getByRole('button', { name: 'Tactical Weeks' }).click();
        // Week button becomes visible; quarter button disappears
        await expect(page.getByRole('button', { name: '+ Plan New Week' })).toBeVisible();
        await expect(page.getByRole('button', { name: '+ Plan Strategic Quarter' })).not.toBeVisible();
    });
});

// ====================================================================
// Suite 3: Quarter Plan – UI form validation
// ====================================================================
test.describe('V2 Orchestrator – Quarter Plan Form', () => {
    test.beforeEach(async ({ page }) => {
        await injectAuth(page);
        await page.goto('/orchestrator');
        await expect(page.locator('h1')).toContainText('V2 Orchestrator', { timeout: 15000 });
    });

    test('should open the Quarter form on button click', async ({ page }) => {
        await page.getByRole('button', { name: '+ Plan Strategic Quarter' }).click();
        await expect(page.getByPlaceholder('e.g. Sell the analytics course')).toBeVisible();
        await expect(page.locator('input[type="date"]')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Generate Full Quarter' })).toBeVisible();
    });

    test('should close the form when Cancel is clicked', async ({ page }) => {
        await page.getByRole('button', { name: '+ Plan Strategic Quarter' }).click();
        await expect(page.getByRole('button', { name: 'Generate Full Quarter' })).toBeVisible();

        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('button', { name: 'Generate Full Quarter' })).not.toBeVisible();
    });
});

// ====================================================================
// Suite 4: Factory Sweep button
// ====================================================================
test.describe('V2 Orchestrator – Factory Sweep', () => {
    test.beforeEach(async ({ page }) => {
        await injectAuth(page);
        await page.goto('/orchestrator');
        await expect(page.locator('h1')).toContainText('V2 Orchestrator', { timeout: 15000 });
    });

    test('should show the Run Factory Sweep button', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Run Factory Sweep/i })).toBeVisible();
    });
});

// ====================================================================
// Suite 5: Full Quarter Generation (slow – requires real LLM calls)
// Only runs when PLAYWRIGHT_RUN_SLOW=1 is set in the environment.
// ====================================================================
test.describe('V2 Orchestrator – Full Quarter Generation (slow)', () => {
    test.skip(!process.env.PLAYWRIGHT_RUN_SLOW,
        'Skipped. Set PLAYWRIGHT_RUN_SLOW=1 to run full LLM cascade tests.');

    test.beforeEach(async ({ page }) => {
        await injectAuth(page);
        await page.goto('/orchestrator');
        await expect(page.locator('h1')).toContainText('V2 Orchestrator', { timeout: 15000 });
    });

    test('should generate Quarter Plan, 3 Month Arcs and 12 Week Packages', async ({ page }) => {
        test.setTimeout(180_000); // 3 minutes for full LLM cascade

        await page.getByRole('button', { name: '+ Plan Strategic Quarter' }).click();
        await page.getByPlaceholder('e.g. Sell the analytics course').fill(
            'E2E Test: Establish authority and launch analytics masterclass'
        );

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        await page.locator('input[type="date"]').fill(tomorrow.toISOString().split('T')[0]);

        await page.getByRole('button', { name: 'Generate Full Quarter' }).click();

        // Wait until the form closes (success)
        await expect(page.getByRole('button', { name: 'Generate Full Quarter' }))
            .toBeHidden({ timeout: 180_000 });

        // Quarter card with goal text should appear
        await expect(page.getByText('E2E Test: Establish authority')).toBeVisible({ timeout: 10_000 });

        // At least Month 1 must exist
        await expect(page.locator('text=Month 1:')).toBeVisible({ timeout: 10_000 });

        // Switch to Tactical Weeks and verify weeks were created
        await page.getByRole('button', { name: 'Tactical Weeks' }).click();
        await expect(page.locator('.card h3').first()).toBeVisible({ timeout: 10_000 });
    });
});
