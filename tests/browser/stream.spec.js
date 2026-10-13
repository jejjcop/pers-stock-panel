// @ts-check
const { test, expect, writePortfolio, row, addStock } = require('./helpers');

// MU: 19 shares at $989.50, $1,088.00 at the last quote, previous close $1,045.56.
test.describe('live prices from the stream', () => {
    test.beforeEach(() => {
        writePortfolio({
            stocks: [
                { ticker: 'MU', list: 'owned' },
                { ticker: 'AAPL', list: 'owned' },
                { ticker: 'NVDA', list: 'monitor' },
            ],
            holdings: { MU: { shares: 19, cost: 989.5 } },
        });
    });

    async function openWithPrices(page) {
        await page.goto('/');
        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');
        await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'live');
    }

    test('subscribes to every stock on the page', async ({ page, stream }) => {
        await openWithPrices(page);

        await expect.poll(() => [...stream.subscribed].sort()).toEqual(['AAPL', 'MU', 'NVDA']);
        await expect(page.locator('#stream-status-text')).toHaveText('Live prices: updated the moment a trade happens.');
    });

    test('shows a trade the moment it arrives, with the change and the holding', async ({ page, stream }) => {
        await openWithPrices(page);

        stream.send({ ticker: 'MU', price: 1100.5 });

        const mu = row(page, 'MU');
        await expect(mu.locator('.quote-price')).toHaveText('$1,100.50');
        await expect(mu.locator('.quote-price')).toHaveClass(/\bflash-up\b/);
        // (1,100.50 - 1,045.56) / 1,045.56 = +5.25%
        await expect(mu.locator('.quote-change')).toHaveText('+5.25%');
        await expect(mu.locator('.holding-value')).toHaveText('$20,909.50');
        await expect(mu.locator('.holding-day-gain')).toHaveText('+$1,043.86');
        await expect(page.locator('#portfolio-value')).toHaveText('$20,909.50');
    });

    test('shows pre-market trades under the price, not as the price', async ({ page, stream }) => {
        await openWithPrices(page);

        stream.send({ ticker: 'MU', price: 1094.25, marketHours: 0 });

        await expect(row(page, 'MU').locator('.extended-hours-value')).toHaveText('Pre-market: $1,094.25 (+0.57%)');
        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');
    });

    test('keeps a newer streamed price when an older quote arrives', async ({ page, stream }) => {
        await openWithPrices(page);
        stream.send({ ticker: 'MU', price: 1100.5, time: Date.now() + 60_000 });
        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,100.50');

        const refreshed = page.waitForResponse(/quotes\.php/);
        await page.getByRole('button', { name: 'Refresh prices' }).click();
        await refreshed;

        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,100.50');
        await expect(row(page, 'MU').locator('.quote-change')).toHaveText('+5.25%');
    });

    test('follows stocks being added and removed', async ({ page, stream }) => {
        await openWithPrices(page);

        await addStock(page, 'TSLA', 'monitor');
        await expect.poll(() => stream.subscribed.has('TSLA')).toBe(true);

        await row(page, 'AAPL').getByRole('button', { name: 'Remove AAPL' }).click();
        await page.locator('#remove-dialog').getByRole('button', { name: 'Remove' }).click();
        await expect.poll(() => stream.subscribed.has('AAPL')).toBe(false);
    });

    test('checks the other figures only once a minute while prices stream', async ({ page }) => {
        await openWithPrices(page);

        await expect(page.locator('#watchlist-status')).toContainText('Market open: prices stream live; other figures refresh every 1 minute.');
        await expect(page.locator('#refresh-countdown')).toHaveText(/^Next refresh in (5\d|60) seconds$/);
    });

    test('connects again after the connection drops', async ({ page, stream }) => {
        await openWithPrices(page);
        await expect.poll(() => stream.subscribed.size).toBe(3);

        stream.dropAll();

        await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'down');
        await expect(page.locator('#watchlist-status')).toContainText('refreshing every 5 seconds');
        // The page retries after 2 seconds and subscribes again.
        await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'live', { timeout: 10_000 });
        await expect.poll(() => [...stream.subscribed].sort()).toEqual(['AAPL', 'MU', 'NVDA']);
        expect(stream.connectionCount).toBe(2);
    });

    test('reconnects when the stream goes quiet while the market is open', async ({ page, stream }) => {
        await page.clock.install();
        await openWithPrices(page);
        expect(stream.connectionCount).toBe(1);

        // No trades for over 30 seconds with the market open.
        await page.clock.fastForward(31_000);

        await expect.poll(() => stream.connectionCount).toBe(2);
    });

    test('decodes a real message from Yahoo\'s stream', async ({ page }) => {
        await page.goto('/');
        // Captured from wss://streamer.finance.yahoo.com on 2026-10-13.
        const message = JSON.stringify({
            type: 'pricing',
            message: 'CgdCVEMtVVNEFXeqokcYgNHQ0aZoIgNVU0QqA0NDQzApOAFF2DIfvUiAgIOM7QFVwy2kR13/lp5HZQCIAcJ9Pq2fR7ABgICDjO0B2AEE4AGAgIOM7QHoAYCAg4ztAfIBA0JUQ4ECAAAAQKMqc0GJAgAA6n/BYXhC9QIAiAHC/QLYMh+9',
        });

        const decoded = await page.evaluate((text) => PriceStream.decodeMessage(text), message);

        expect(decoded).toMatchObject({ ticker: 'BTC-USD', session: 'regular', time: Date.UTC(2026, 9, 13, 11, 51, 4) });
        expect(decoded.price).toBeCloseTo(83284.93, 2);
        expect(decoded.changePercent).toBeCloseTo(-0.0389, 4);
    });

    test('ignores messages it cannot read', async ({ page }) => {
        await page.goto('/');

        const decoded = await page.evaluate(() => [
            PriceStream.decodeMessage('not json'),
            PriceStream.decodeMessage(JSON.stringify({ type: 'heartbeat' })),
            PriceStream.decodeMessage(JSON.stringify({ type: 'pricing', message: '!!!' })),
            PriceStream.decodeMessage(JSON.stringify({ type: 'pricing', message: 'CgJNVQ==' })),
        ]);

        expect(decoded).toEqual([null, null, null, null]);
    });

    test.describe('when the stream cannot be reached', () => {
        test.use({ expectedConsoleErrors: [/WebSocket/] });

        test('falls back to checking prices every 5 seconds', async ({ page, stream }) => {
            stream.refuse = true;
            await page.goto('/');
            await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');

            await expect(page.locator('#stream-status')).toHaveAttribute('data-state', 'down');
            await expect(page.locator('#stream-status-text')).toContainText('Live prices are unavailable right now');
            await expect(page.locator('#watchlist-status')).toContainText('Market open: refreshing every 5 seconds.');
        });
    });
});
