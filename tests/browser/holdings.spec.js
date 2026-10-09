// @ts-check
const { test, expect, writePortfolio, row, quotesResponse } = require('./helpers');

// MU: 19 shares at $989.50, now $1,088.00, previous close $1,045.56.
// AAPL: 10 shares at $150.00, now $336.67, previous close $333.63.
test.describe('holdings in My current stocks', () => {
    test.beforeEach(() => {
        writePortfolio({
            stocks: [
                { ticker: 'MU', list: 'owned' },
                { ticker: 'AAPL', list: 'owned' },
                { ticker: 'MSFT', list: 'owned' },
                { ticker: 'NVDA', list: 'monitor' },
            ],
            holdings: {
                MU: { shares: 19, cost: 989.5 },
                AAPL: { shares: 10, cost: 150 },
            },
        });
    });

    test('loads the shares and costs from the data file', async ({ page }) => {
        await page.goto('/');

        await expect(row(page, 'MU').locator('.holding-input[data-field="shares"]')).toHaveValue('19');
        await expect(row(page, 'MU').locator('.holding-input[data-field="cost"]')).toHaveValue('989.5');
        await expect(row(page, 'MSFT').locator('.holding-input[data-field="shares"]')).toHaveValue('');
    });

    test('calculates cost, value and gain for each stock', async ({ page }) => {
        await page.goto('/');

        const mu = row(page, 'MU');
        await expect(mu.locator('.holding-cost-total')).toHaveText('$18,800.50');
        await expect(mu.locator('.holding-value')).toHaveText('$20,672.00');
        // (1,088.00 - 989.50) x 19 = 1,871.50, which is 98.50 / 989.50 = +9.95%
        await expect(mu.locator('.holding-gain')).toHaveText('+$1,871.50 (+9.95%)');
        await expect(mu.locator('.holding-gain')).toHaveClass(/\bup\b/);

        await expect(row(page, 'MSFT').locator('.holding-value')).toHaveText('—');
    });

    test('adds up the totals, weighted by how much of each stock you own', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#portfolio-cost')).toHaveText('$20,300.50');
        await expect(page.locator('#portfolio-value')).toHaveText('$24,038.70');
        // Today: 19 x 42.44 + 10 x 3.04 = 836.76, against 23,201.94 at yesterday's close.
        await expect(page.locator('#portfolio-day')).toHaveText('+$836.76 (+3.61%)');
        // Gain: 24,038.70 - 20,300.50 = 3,738.20, which is +18.41% of the cost.
        await expect(page.locator('#portfolio-gain')).toHaveText('+$3,738.20 (+18.41%)');
    });

    test('shows each stock\'s share of the portfolio', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#allocation-panel')).toBeVisible();
        await expect(page.locator('#allocation-list .allocation-ticker')).toHaveText(['MU', 'AAPL']);
        await expect(page.locator('#allocation-list .allocation-share')).toHaveText(['86.0%', '14.0%']);
        await expect(page.locator('#allocation-list .allocation-value')).toHaveText(['$20,672.00', '$3,366.70']);
    });

    test('shows how much each holding gained or lost today', async ({ page }) => {
        await page.goto('/');

        // MU: 19 x (1,088.00 - 1,045.56). AAPL: 10 x (336.67 - 333.63).
        await expect(row(page, 'MU').locator('.holding-day-gain')).toHaveText('+$806.36');
        await expect(row(page, 'MU').locator('.holding-day-gain')).toHaveClass(/\bup\b/);
        await expect(row(page, 'AAPL').locator('.holding-day-gain')).toHaveText('+$30.40');
        await expect(row(page, 'MSFT').locator('.holding-day-gain')).toHaveText('—');
    });

    test('shows the total value and today\'s change in kronor', async ({ page }) => {
        await page.goto('/');

        // At the test rate of 10 kronor per dollar.
        await expect(page.locator('#portfolio-value-sek')).toHaveText('≈ SEK 240,387');
        await expect(page.locator('#portfolio-day-sek')).toHaveText('≈ +SEK 8,368');
        await expect(page.locator('#fx-note')).toContainText('1 USD = 10.0000 SEK');
        // Cost and gain need the rate on the day of purchase, so they stay in dollars.
        await expect(page.locator('#portfolio-cost')).toHaveText('$20,300.50');
    });

    test('leaves out kronor when there is no exchange rate', async ({ page }) => {
        await page.route('**/quotes.php?*', (route) => {
            const symbols = new URL(route.request().url()).searchParams.get('symbols') ?? '';
            return route.fulfill({ json: { ...quotesResponse(symbols.split(',')), fxRates: {} } });
        });
        await page.goto('/');

        await expect(page.locator('#portfolio-value')).toHaveText('$24,038.70');
        await expect(page.locator('#portfolio-value-sek')).toBeHidden();
        await expect(page.locator('#fx-note')).toBeHidden();
    });

    test('updates the totals as you type', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#portfolio-value')).toHaveText('$24,038.70');

        await row(page, 'AAPL').locator('.holding-input[data-field="shares"]').fill('20');

        await expect(row(page, 'AAPL').locator('.holding-value')).toHaveText('$6,733.40');
        await expect(page.locator('#portfolio-value')).toHaveText('$27,405.40');
    });

    test('hides the totals when no shares are entered', async ({ page }) => {
        writePortfolio({ stocks: [{ ticker: 'MU', list: 'owned' }] });
        await page.goto('/');
        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');

        await expect(page.locator('#portfolio-summary')).toBeHidden();
        await expect(page.locator('#allocation-panel')).toBeHidden();
    });

    test('leaves stocks to monitor out of the totals', async ({ page }) => {
        writePortfolio({
            stocks: [{ ticker: 'MU', list: 'owned' }, { ticker: 'NVDA', list: 'monitor' }],
            holdings: { MU: { shares: 19, cost: 989.5 }, NVDA: { shares: 100, cost: 100 } },
        });
        await page.goto('/');

        await expect(page.locator('#portfolio-value')).toHaveText('$20,672.00');
        await expect(page.locator('[data-section="monitor"] .holding-input').first()).toBeHidden();
    });
});
