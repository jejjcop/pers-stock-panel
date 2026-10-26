// @ts-check
const { test, expect, writePortfolio, readPortfolio, savedStocks, tickersIn, row, addStock, createStream, stubYahoo, logIn } = require('./helpers');

test.describe('saving', () => {
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

    test('saves a stock you add', async ({ page }) => {
        await page.goto('/');

        await addStock(page, 'tsla', 'monitor');

        await expect(row(page, 'TSLA')).toBeVisible();
        expect(await tickersIn(page, 'monitor')).toContain('TSLA');
        await expect.poll(savedStocks).toContain('TSLA/monitor');
        await expect(page.locator('#save-status')).toHaveText(/^All changes saved at /);
    });

    test('moves a stock to the other section and keeps its shares', async ({ page }) => {
        await page.goto('/');

        await addStock(page, 'MU', 'monitor');

        await expect(page.locator('#watchlist-status')).toHaveText('MU moved from My current stocks to Stocks to monitor.');
        await expect.poll(savedStocks).toEqual(['AAPL/owned', 'MU/monitor', 'NVDA/monitor']);
        expect(readPortfolio().holdings.MU).toEqual({ shares: 19, cost: 989.5 });
    });

    test('refuses a ticker with characters a ticker cannot have', async ({ page }) => {
        await page.goto('/');
        await expect(row(page, 'MU').locator('.quote-price')).toHaveText('$1,088.00');

        await addStock(page, 'BAD TICKER', 'owned');

        expect(await page.locator('#new-ticker').evaluate((input) => /** @type {HTMLInputElement} */ (input).validity.patternMismatch)).toBe(true);
        await expect(page.locator('tbody[data-list] tr')).toHaveCount(3);
        expect(savedStocks()).toEqual(['AAPL/owned', 'MU/owned', 'NVDA/monitor']);
    });

    test('does not add a stock twice', async ({ page }) => {
        await page.goto('/');

        await addStock(page, 'AAPL', 'owned');

        await expect(page.locator('#watchlist-status')).toHaveText('AAPL is already in My current stocks.');
        await expect(row(page, 'AAPL')).toHaveCount(1);
    });

    test('removes a stock and its shares only after you confirm', async ({ page }) => {
        await page.goto('/');
        const dialog = page.locator('#remove-dialog');

        await row(page, 'MU').getByRole('button', { name: 'Remove MU' }).click();
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('the shares and average cost you entered for it will be deleted');
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        await expect(dialog).toBeHidden();
        await expect(row(page, 'MU')).toBeVisible();

        await row(page, 'MU').getByRole('button', { name: 'Remove MU' }).click();
        await dialog.getByRole('button', { name: 'Remove' }).click();

        await expect(row(page, 'MU')).toHaveCount(0);
        await expect.poll(savedStocks).toEqual(['AAPL/owned', 'NVDA/monitor']);
        expect(readPortfolio().holdings).toEqual({});
    });

    test('saves shares and costs as you type', async ({ page }) => {
        await page.goto('/');

        await row(page, 'AAPL').locator('.holding-input[data-field="shares"]').fill('10');
        await row(page, 'AAPL').locator('.holding-input[data-field="cost"]').fill('150.25');

        await expect.poll(() => readPortfolio().holdings.AAPL).toEqual({ shares: 10, cost: 150.25 });
    });

    test('shows the saved stocks again in a new browser', async ({ page, browser }) => {
        await page.goto('/');
        await addStock(page, 'TSLA', 'owned');
        await expect.poll(savedStocks).toContain('TSLA/owned');

        // A new context has no cookies or browser storage, like another browser.
        const otherBrowser = await browser.newContext();
        await stubYahoo(otherBrowser, createStream());
        await logIn(otherBrowser);
        const otherPage = await otherBrowser.newPage();
        await otherPage.goto('/');

        await expect(otherPage.locator('tbody[data-list="owned"] tr[data-ticker="TSLA"]')).toBeVisible();
        await expect(otherPage.locator('tr[data-ticker="MU"] .holding-input[data-field="shares"]')).toHaveValue('19');
        await otherBrowser.close();
    });

    test.describe('when the server cannot save', () => {
        // The browser logs the failed request; that is the point of the test.
        test.use({ expectedConsoleErrors: [/status of 500/] });

        test('says so on the page', async ({ page }) => {
            await page.route('**/portfolio', (route) => route.fulfill({ status: 500, json: { error: 'The data file could not be written.' } }));
            await page.goto('/');

            await addStock(page, 'TSLA', 'owned');

            await expect(page.locator('#save-status')).toHaveText('Your latest changes are not saved yet: The data file could not be written. Trying again in 10 seconds.');
            await expect(page.locator('#save-status')).toHaveClass(/\bis-error\b/);
        });
    });
});

test.describe('the first visit, before anything is saved', () => {
    test.beforeEach(() => {
        writePortfolio(null);
    });

    test('starts with the built-in stocks and saves them', async ({ page }) => {
        await page.goto('/');

        expect(await tickersIn(page, 'owned')).toEqual(expect.arrayContaining(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META']));
        await expect.poll(savedStocks).toEqual(['AAPL/owned', 'AMZN/owned', 'META/owned', 'MSFT/owned', 'NVDA/owned']);
    });

    test('copies in stocks and shares saved in the browser by older versions', async ({ page }) => {
        await page.addInitScript(() => {
            if (!localStorage.getItem('stock-panel-added-tickers')) {
                localStorage.setItem('stock-panel-added-tickers', JSON.stringify({
                    added: [{ ticker: 'NVDA', list: 'monitor' }, { ticker: 'MU', list: 'owned' }],
                    removed: ['META'],
                }));
                localStorage.setItem('stock-panel-holdings', JSON.stringify({ MU: { shares: 19, cost: 989.5 } }));
            }
        });
        await page.goto('/');

        await expect.poll(savedStocks).toEqual(['AAPL/owned', 'AMZN/owned', 'MSFT/owned', 'MU/owned', 'NVDA/monitor']);
        expect(readPortfolio().holdings).toEqual({ MU: { shares: 19, cost: 989.5 } });
    });

    test('does not copy the browser data in again later', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('stock-panel-added-tickers', JSON.stringify({ added: [{ ticker: 'TSLA', list: 'owned' }], removed: [] }));
        });
        await page.goto('/');
        await expect.poll(savedStocks).toContain('TSLA/owned');

        // Deleting the data file must not bring the old browser data back.
        writePortfolio(null);
        await page.reload();

        await expect.poll(savedStocks).toEqual(['AAPL/owned', 'AMZN/owned', 'META/owned', 'MSFT/owned', 'NVDA/owned']);
    });
});
