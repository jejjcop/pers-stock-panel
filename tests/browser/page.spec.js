// @ts-check
const { test, expect, writePortfolio, tickersIn, row } = require('./helpers');

test.describe('the page', () => {
    test.beforeEach(() => {
        writePortfolio({
            stocks: [
                { ticker: 'MSFT', list: 'owned' },
                { ticker: 'AAPL', list: 'owned' },
                { ticker: 'MU', list: 'owned' },
                { ticker: 'NVDA', list: 'monitor' },
            ],
        });
    });

    test('shows each stock in its section with its prices', async ({ page }) => {
        await page.goto('/');

        const mu = row(page, 'MU');
        await expect(mu.locator('.quote-name')).toHaveText('Micron Technology, Inc.');
        await expect(mu.locator('.quote-price')).toHaveText('$1,088.00');
        await expect(mu.locator('.quote-change')).toHaveText('+4.06%');
        await expect(mu.locator('.quote-week')).toHaveText('+1.50%');
        await expect(mu.locator('.quote-month')).toHaveText('-2.50%');
        await expect(mu.locator('.quote-volume')).toHaveText('12.3M');
        await expect(row(page, 'NVDA').locator('.quote-change')).toHaveText('-0.74%');

        expect(await tickersIn(page, 'monitor')).toEqual(['NVDA']);
    });

    test('colors rises green and falls red', async ({ page }) => {
        await page.goto('/');

        await expect(row(page, 'MU').locator('.quote-change')).toHaveClass(/\bup\b/);
        await expect(row(page, 'NVDA').locator('.quote-change')).toHaveClass(/\bdown\b/);
    });

    test('sorts each section by today\'s change, best first', async ({ page }) => {
        await page.goto('/');
        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');

        // MU +4.06%, AAPL +0.91%, MSFT +0.09%
        expect(await tickersIn(page, 'owned')).toEqual(['MU', 'AAPL', 'MSFT']);
    });

    test('draws a chart of today\'s prices for each stock', async ({ page }) => {
        await page.goto('/');

        await expect(row(page, 'MU').locator('.quote-chart svg.sparkline.up path.sparkline-line')).toBeVisible();
        await expect(row(page, 'NVDA').locator('.quote-chart svg.sparkline.down')).toBeVisible();
    });

    test('shows whether the market is open and when it closes', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#market-status-label')).toHaveText('Market open');
        await expect(page.locator('#market-status-countdown')).toHaveText(/^US market · closes in 2h [45]m$/);
    });

    test('shows a message instead of an empty table', async ({ page }) => {
        writePortfolio({ stocks: [{ ticker: 'MU', list: 'owned' }] });
        await page.goto('/');

        await expect(page.locator('#monitor-empty')).toBeVisible();
        await expect(page.locator('[data-section="monitor"] .table-wrap')).toBeHidden();
    });
});
