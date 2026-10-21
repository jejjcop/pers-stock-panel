// @ts-check
const { test, expect, writePortfolio, addStock } = require('./helpers');

// The made-up day: MU opened three hours ago, with points an hour ago at the
// previous close ($1,045.56), half an hour ago halfway ($1,066.78) and now at
// $1,088.00. The session closes in 2 hours 5 minutes.
test.describe("today's graphs", () => {
    test.beforeEach(() => {
        writePortfolio({
            stocks: [
                { ticker: 'AAPL', list: 'owned' },
                { ticker: 'MU', list: 'owned' },
                { ticker: 'NVDA', list: 'monitor' },
            ],
            holdings: { MU: { shares: 19, cost: 989.5 } },
        });
    });

    function card(page, ticker) {
        return page.locator(`.live-chart-card[data-ticker="${ticker}"]`);
    }

    async function cardTickers(page) {
        return page.locator('.live-chart-card').evaluateAll(
            (cards) => cards.map((element) => /** @type {HTMLElement} */ (element).dataset.ticker)
        );
    }

    async function openWithPrices(page) {
        await page.goto('/');
        await expect(card(page, 'MU').locator('.live-chart-price')).toHaveText('$1,088.00');
        await expect(card(page, 'MU').locator('svg.live-chart')).toBeVisible();
    }

    test('shows a graph for each stock in My current stocks, in the same order as the table', async ({ page }) => {
        await openWithPrices(page);

        await expect(page.locator('#live-charts-panel')).toBeVisible();
        // Sorted by today's change like the table: MU +4.06%, AAPL +0.91%.
        expect(await cardTickers(page)).toEqual(['MU', 'AAPL']);

        const mu = card(page, 'MU');
        await expect(mu.locator('.live-chart-name')).toHaveText('Micron Technology, Inc.');
        await expect(mu.locator('.live-chart-change')).toHaveText('+$42.44 (+4.06%)');
        await expect(mu.locator('.live-chart-when')).toHaveText('Today');
        await expect(mu.locator('svg.live-chart')).toHaveClass(/\bup\b/);
        await expect(mu.locator('.live-chart-line')).toHaveCount(1);
        await expect(mu.locator('.live-chart-previous-close')).toHaveCount(1);
        // The market is open, so the newest price pulses.
        await expect(mu.locator('.live-chart-pulse')).toHaveCount(1);
    });

    test('moves with every live trade', async ({ page, stream }) => {
        await openWithPrices(page);
        await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'live');
        const mu = card(page, 'MU');
        const lastDot = mu.locator('.live-chart-last');
        const dotBefore = Number(await lastDot.getAttribute('cx'));

        stream.send({ ticker: 'MU', price: 1100.5, time: Date.now() + 60_000 });

        await expect(mu.locator('.live-chart-price')).toHaveText('$1,100.50');
        await expect(mu.locator('.live-chart-change')).toHaveText('+$54.94 (+5.25%)');
        await expect(mu.locator('svg.live-chart')).toHaveAttribute('aria-label', /to \$1,100\.50$/);
        // A minute later, so the end of the line moved right.
        await expect.poll(async () => Number(await lastDot.getAttribute('cx'))).toBeGreaterThan(dotBefore);
    });

    test('keeps live trades on the graph when the other figures refresh', async ({ page, stream }) => {
        await openWithPrices(page);
        await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'live');
        const mu = card(page, 'MU');

        stream.send({ ticker: 'MU', price: 1100.5, time: Date.now() + 60_000 });
        await expect(mu.locator('svg.live-chart')).toHaveAttribute('aria-label', /to \$1,100\.50$/);

        await page.getByRole('button', { name: 'Refresh prices' }).click();
        await expect(page.getByRole('button', { name: 'Refresh prices' })).toBeEnabled();

        await expect(mu.locator('svg.live-chart')).toHaveAttribute('aria-label', /to \$1,100\.50$/);
        await expect(mu.locator('.live-chart-price')).toHaveText('$1,100.50');
    });

    test('shows the price where you point, and the latest price again after', async ({ page }) => {
        await openWithPrices(page);
        const mu = card(page, 'MU');
        const box = await mu.locator('svg.live-chart').boundingBox();
        if (!box) {
            throw new Error('the graph has no size');
        }

        // Half an hour ago, measured across the whole session (3 hours ago
        // to 2 hours 5 minutes from now), with the graph's 2px left margin
        // and 64px of price labels on the right.
        const fraction = (3 * 3600 - 1800) / (5 * 3600 + 5 * 60);
        await page.mouse.move(box.x + 2 + fraction * (box.width - 66), box.y + box.height / 2);

        await expect(mu.locator('.live-chart-price')).toHaveText('$1,066.78');
        await expect(mu.locator('.live-chart-change')).toHaveText('+$21.22 (+2.03%)');
        await expect(mu.locator('.live-chart-when')).toHaveText(/^at \d\d:\d\d/);
        await expect(mu.locator('.live-chart-hover-line')).toHaveAttribute('visibility', 'visible');

        await page.mouse.move(0, 0);

        await expect(mu.locator('.live-chart-price')).toHaveText('$1,088.00');
        await expect(mu.locator('.live-chart-when')).toHaveText('Today');
        await expect(mu.locator('.live-chart-hover-line')).toHaveAttribute('visibility', 'hidden');
    });

    test('follows stocks into and out of My current stocks', async ({ page }) => {
        await openWithPrices(page);

        await addStock(page, 'MU', 'monitor');
        await expect(card(page, 'MU')).toHaveCount(0);
        expect(await cardTickers(page)).toEqual(['AAPL']);

        await addStock(page, 'NVDA', 'owned');
        await expect(card(page, 'NVDA').locator('.live-chart-price')).toHaveText('$237.47');
        await expect(card(page, 'NVDA').locator('svg.live-chart')).toHaveClass(/\bdown\b/);

        await addStock(page, 'AAPL', 'monitor');
        await addStock(page, 'NVDA', 'monitor');
        await expect(page.locator('#live-charts-panel')).toBeHidden();
    });

    test('opens the large chart from a graph', async ({ page }) => {
        await openWithPrices(page);

        await card(page, 'MU').getByRole('button', { name: 'MU', exact: true }).click();

        await expect(page.locator('#chart-dialog')).toBeVisible();
        await expect(page.locator('#chart-dialog-title')).toHaveText('MU');
    });
});
