// @ts-check
const { test, expect, writePortfolio, tickersIn, row, quotesResponse } = require('./helpers');

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

    // Common laptop and desktop screen widths.
    for (const width of [1280, 1366, 1536, 1920]) {
        test(`fits a ${width} pixel wide screen without scrolling sideways`, async ({ page }) => {
            // A heavy portfolio: big amounts, long names and after-hours prices
            // make every column as wide as it gets.
            writePortfolio({
                stocks: ['MU', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'BRK-B', 'TSLA'].map((ticker, index) => ({
                    ticker,
                    list: index < 6 ? 'owned' : 'monitor',
                })),
                holdings: {
                    MU: { shares: 12345, cost: 989.5 },
                    AAPL: { shares: 2500, cost: 150.25 },
                    MSFT: { shares: 800.5, cost: 410 },
                },
            });
            await page.route('**/quotes?*', (route) => {
                const symbols = (new URL(route.request().url()).searchParams.get('symbols') ?? '').split(',');
                const response = quotesResponse(symbols);
                Object.entries(response.quotes).forEach(([ticker, quote]) => {
                    response.extendedQuotes[ticker] = {
                        ...response.extendedQuotes[ticker],
                        activeSession: 'afterHours',
                        afterHours: { price: quote.price * 1.0123, time: Math.floor(Date.now() / 1000) },
                    };
                });
                return route.fulfill({ json: response });
            });
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/');
            await expect(row(page, 'MU').locator('.extended-hours-value')).toHaveText(/^After-hours:/);

            const overflow = await page.evaluate(() => ({
                page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                tables: Array.from(document.querySelectorAll('.table-wrap'), (wrap) => wrap.scrollWidth - wrap.clientWidth),
            }));

            expect(overflow).toEqual({ page: 0, tables: [0, 0] });
        });
    }

    // The day total in the summary, the Day column in both tables and the
    // heading of the graphs are named after the trading day the prices come from.
    test.describe('the day labels', () => {
        const day = 86_400_000;

        // Serves quotes whose latest regular-hours trade was the given time ago.
        async function lastTradeAgo(page, ago) {
            await page.route('**/quotes?*', (route) => {
                const symbols = (new URL(route.request().url()).searchParams.get('symbols') ?? '').split(',');
                const response = quotesResponse(symbols);
                Object.values(response.quotes).forEach((quote) => {
                    quote.marketTime -= ago / 1000;
                });
                return route.fulfill({ json: response });
            });
            await page.goto('/');
            await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');
        }

        test('say Today once today\'s trading has started', async ({ page }) => {
            await lastTradeAgo(page, 0);

            await expect(page.locator('.day-label')).toHaveText(['Today', 'Today', 'Today', 'Today']);
            await expect(page.locator('th.col-chart')).toHaveText(['Chart', 'Chart']);
        });

        test('say Yesterday before the market opens', async ({ page }) => {
            await lastTradeAgo(page, day);

            await expect(page.locator('.day-label')).toHaveText(['Yesterday', 'Yesterday', 'Yesterday', 'Yesterday']);
        });

        test('name the weekday when the prices are older, e.g. on a Monday morning', async ({ page }) => {
            await lastTradeAgo(page, 3 * day);

            const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(Date.now() - 3 * day);
            await expect(page.locator('.day-label')).toHaveText([weekday, weekday, weekday, weekday]);
        });

        test('switch to Today with the first trade of the day', async ({ page, stream }) => {
            await lastTradeAgo(page, day);
            await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'live');
            await expect(page.locator('.day-label').first()).toHaveText('Yesterday');

            stream.send({ ticker: 'MU', price: 1100.5 });

            await expect(page.locator('.day-label')).toHaveText(['Today', 'Today', 'Today', 'Today']);
        });
    });

    test('shows a message instead of an empty table', async ({ page }) => {
        writePortfolio({ stocks: [{ ticker: 'MU', list: 'owned' }] });
        await page.goto('/');

        await expect(page.locator('#monitor-empty')).toBeVisible();
        await expect(page.locator('[data-section="monitor"] .table-wrap')).toBeHidden();
    });
});
