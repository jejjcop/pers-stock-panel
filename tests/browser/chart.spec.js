// @ts-check
const { test, expect, writePortfolio, row } = require('./helpers');

// The made-up history: today 1,040 -> 1,060 -> 1,088 against a previous
// close of 1,045.56; the past year 800 -> 950 -> 1,088.
test.describe('the large chart', () => {
    test.beforeEach(() => {
        writePortfolio({
            stocks: [{ ticker: 'MU', list: 'owned' }, { ticker: 'NVDA', list: 'monitor' }],
            holdings: { MU: { shares: 19, cost: 989.5 }, NVDA: { shares: 5, cost: 200 } },
        });
    });

    async function openFromTicker(page, ticker) {
        await page.goto('/');
        await expect(row(page, ticker).locator('.quote-price')).not.toHaveText('—');
        await row(page, ticker).getByRole('button', { name: ticker, exact: true }).click();
    }

    test('opens from the ticker and shows today against the previous close', async ({ page }) => {
        await openFromTicker(page, 'MU');
        const dialog = page.locator('#chart-dialog');

        await expect(dialog).toBeVisible();
        await expect(page.locator('#chart-dialog-title')).toHaveText('MU');
        await expect(page.locator('#chart-dialog-name')).toHaveText('Micron Technology, Inc.');
        await expect(dialog.getByRole('button', { name: '1D' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#chart-dialog-change')).toHaveText('+$42.44 (+4.06%) today');
        await expect(dialog.locator('svg.large-chart.up path.large-chart-line')).toBeVisible();
        await expect(dialog.locator('.large-chart-reference-label')).toHaveText(['Prev close $1,045.56', 'Your avg $989.50']);
    });

    test('opens from the small chart too', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: 'Open a larger chart of MU' }).click();

        await expect(page.locator('#chart-dialog-title')).toHaveText('MU');
    });

    test('switches to another period', async ({ page }) => {
        await openFromTicker(page, 'MU');
        const dialog = page.locator('#chart-dialog');
        await expect(page.locator('#chart-dialog-change')).toHaveText(/today$/);

        const request = page.waitForRequest((sent) => sent.url().includes('/history?') && sent.url().includes('range=1y'));
        await dialog.getByRole('button', { name: '1Y' }).click();
        await request;

        await expect(dialog.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.getByRole('button', { name: '1D' })).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#chart-dialog-change')).toHaveText('+$288.00 (+36.00%) past year');
        // Only the one-day chart has a previous close.
        await expect(dialog.locator('.large-chart-reference-label')).toHaveText(['Your avg $989.50']);
    });

    test('shows the price where you point', async ({ page }) => {
        await openFromTicker(page, 'MU');
        const hitArea = page.locator('.large-chart-hit-area');
        const box = await hitArea.boundingBox();

        await hitArea.hover({ position: { x: (box?.width ?? 2) - 2, y: (box?.height ?? 2) / 2 } });

        await expect(page.locator('#chart-dialog-tooltip')).toBeVisible();
        await expect(page.locator('#chart-dialog-tooltip strong')).toHaveText('$1,088.00');

        await page.mouse.move(0, 0);
        await expect(page.locator('#chart-dialog-tooltip')).toBeHidden();
    });

    test('hides the price box when you switch period', async ({ page }) => {
        await openFromTicker(page, 'MU');
        const hitArea = page.locator('.large-chart-hit-area');
        await hitArea.hover();
        await expect(page.locator('#chart-dialog-tooltip')).toBeVisible();

        await page.locator('#chart-dialog').getByRole('button', { name: '1Y' }).click();

        await expect(page.locator('#chart-dialog-change')).toHaveText(/past year$/);
        await expect(page.locator('#chart-dialog-tooltip')).toBeHidden();
    });

    test('price axis always covers the highest and lowest price', async ({ page }) => {
        await page.goto('/');

        // A year that ran from 765 to 1,135 once ended its axis at 1,100.
        const { ticks } = await page.evaluate(() => niceTicks(765, 1135, 5));

        expect(ticks[0]).toBeLessThanOrEqual(765);
        expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1135);
        expect(ticks).toEqual([700, 800, 900, 1000, 1100, 1200]);
    });

    test('says yesterday when the one-day chart shows yesterday\'s session', async ({ page }) => {
        await page.route('**/history?*', (route) => {
            const now = Math.floor(Date.now() / 1000) - 86_400;
            return route.fulfill({
                json: {
                    symbol: 'MU',
                    range: '1d',
                    currency: 'USD',
                    previousClose: 1045.56,
                    points: [[now - 7200, 1040], [now - 3600, 1060], [now, 1088]],
                },
            });
        });
        await openFromTicker(page, 'MU');

        await expect(page.locator('#chart-dialog-change')).toHaveText('+$42.44 (+4.06%) yesterday');
    });

    test('has no average cost line for stocks to monitor', async ({ page }) => {
        await openFromTicker(page, 'NVDA');

        await expect(page.locator('.large-chart-reference-label')).toHaveText(['Prev close $1,045.56']);
    });

    test('closes with the Close button and with Escape', async ({ page }) => {
        await openFromTicker(page, 'MU');
        const dialog = page.locator('#chart-dialog');

        await dialog.getByRole('button', { name: 'Close chart' }).click();
        await expect(dialog).toBeHidden();

        await row(page, 'MU').getByRole('button', { name: 'MU', exact: true }).click();
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });

    test('says so when there are no trades yet today', async ({ page }) => {
        await page.route('**/history?*', (route) => route.fulfill({
            json: { symbol: 'MU', range: '1d', currency: 'USD', previousClose: 1045.56, points: [] },
        }));
        await openFromTicker(page, 'MU');

        await expect(page.locator('#chart-dialog-status')).toHaveText('No trades yet today. Regular trading starts at 9:30 New York time.');
        await expect(page.locator('#chart-dialog svg')).toHaveCount(0);
    });

    test.describe('when the history cannot be loaded', () => {
        test.use({ expectedConsoleErrors: [/status of 502/] });

        test('says so in the chart window', async ({ page }) => {
            await page.route('**/history?*', (route) => route.fulfill({
                status: 502,
                json: { error: 'Yahoo Finance returned HTTP 500.' },
            }));
            await openFromTicker(page, 'MU');

            await expect(page.locator('#chart-dialog-status')).toHaveText('Could not load the chart: Yahoo Finance returned HTTP 500.');
            await expect(page.locator('#chart-dialog-status')).toHaveClass(/\bis-error\b/);
        });
    });
});
