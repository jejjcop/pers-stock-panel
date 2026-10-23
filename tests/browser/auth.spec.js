// @ts-check
const { test, expect, writePortfolio, readPortfolio, readAuth, row, testPassword, logIn } = require('./helpers');

test.describe('logging in', () => {
    // These tests start logged out.
    test.use({ loggedIn: false });

    test.beforeEach(() => {
        writePortfolio({ stocks: [{ ticker: 'MU', list: 'owned' }], holdings: { MU: { shares: 19, cost: 989.5 } } });
    });

    async function submitPassword(page, password) {
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Log in' }).click();
    }

    test('sends you to the login page until you log in', async ({ page }) => {
        await page.goto('/');

        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
        await expect(page.locator('tbody[data-list]')).toHaveCount(0);
    });

    test('refuses a wrong password', async ({ page }) => {
        await page.goto('/login');

        await submitPassword(page, 'not-the-password');

        await expect(page.getByRole('alert')).toHaveText('Wrong password.');
        await expect(page).toHaveURL(/\/login$/);
    });

    test('opens the app with the right password, until you log out', async ({ page }) => {
        await page.goto('/login');

        await submitPassword(page, testPassword);

        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');

        await page.getByRole('button', { name: 'Log out' }).click();
        await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
        await page.goto('/');
        await expect(page).toHaveURL(/\/login$/);
    });

    test('pauses logging in after too many wrong passwords', async ({ page }) => {
        await page.goto('/login');

        for (let attempt = 1; attempt <= 5; attempt += 1) {
            await submitPassword(page, `wrong-${attempt}`);
            await expect(page.getByRole('alert')).toBeVisible();
        }
        await expect(page.getByRole('alert')).toHaveText('Wrong password, or too many attempts. Try again in 30 seconds.');

        // Even the right password is not accepted until the pause is over.
        await submitPassword(page, testPassword);
        await expect(page.getByRole('alert')).toContainText('Try again in');
        expect(readAuth().failedAttempts).toBe(5);
    });

    test('gives nothing away to requests without a login', async ({ page }) => {
        const before = readPortfolio();

        const quotes = await page.request.get('/quotes?symbols=MU');
        const history = await page.request.get('/history?symbol=MU&range=1d');
        // Not from the app's own page and without its security token, so
        // Laravel refuses it (419) before even checking the login.
        const save = await page.request.post('/portfolio', { data: { stocks: [], holdings: {} } });

        expect([quotes.status(), history.status(), save.status()]).toEqual([401, 401, 419]);
        expect(await quotes.json()).toEqual({ error: 'You are not logged in.' });
        expect(readPortfolio()).toEqual(before);
    });

    test('refuses to save from anywhere but the app\'s own page, even when logged in', async ({ page }) => {
        await logIn(page);
        const before = readPortfolio();

        // As if another website made the browser send this.
        const save = await page.request.post('/portfolio', { data: { stocks: [], holdings: {} } });

        expect(save.status()).toBe(419);
        expect(readPortfolio()).toEqual(before);
    });

    test('lets you choose a password on the first visit', async ({ page }) => {
        writePortfolio({ stocks: [{ ticker: 'MU', list: 'owned' }] }, { withPassword: false });
        await page.goto('/');

        await expect(page.getByRole('heading', { name: 'Choose a password' })).toBeVisible();
        await page.getByLabel('Password', { exact: true }).fill('my new password');
        await page.getByLabel('The same password again').fill('my new passwrod');
        await page.getByRole('button', { name: 'Save password and log in' }).click();
        await expect(page.getByRole('alert')).toHaveText('The two passwords are not the same.');
        expect(readAuth()).toBeNull();

        await page.getByLabel('Password', { exact: true }).fill('my new password');
        await page.getByLabel('The same password again').fill('my new password');
        await page.getByRole('button', { name: 'Save password and log in' }).click();

        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');
        // Only a hash of the password is stored, never the password itself.
        expect(readAuth().passwordHash).toMatch(/^\$2y\$/);
        expect(JSON.stringify(readAuth())).not.toContain('my new password');
    });

    test.describe('when the login runs out', () => {
        // The browser logs the refused request; that is the point of the test.
        test.use({ expectedConsoleErrors: [/status of 401/] });

        test('sends an open page to the login page', async ({ page, context }) => {
            await logIn(page);
            await page.goto('/');
            await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');

            // As if the login had expired. The next price refresh goes to the
            // app's own server (not the test's made-up prices), which refuses it.
            await context.clearCookies();
            await page.unroute('**/quotes?*');
            await page.getByRole('button', { name: 'Refresh prices' }).click();

            await expect(page).toHaveURL(/\/login\?expired=1$/);
            await expect(page.getByRole('status')).toHaveText('You have been logged out. Log in again to continue.');
        });
    });
});
