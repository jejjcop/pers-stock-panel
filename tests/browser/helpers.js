// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const base = require('@playwright/test');

const dataDir = /** @type {string} */ (process.env.STOCK_PANEL_TEST_DATA_DIR);
const dataFile = path.join(dataDir, 'portfolio.json');

/**
 * Made-up prices the tests use instead of Yahoo Finance. Day change is
 * calculated from price and previous close, like the real endpoint does.
 */
const prices = {
    MU: { name: 'Micron Technology, Inc.', price: 1088, previousClose: 1045.56 },
    AAPL: { name: 'Apple Inc.', price: 336.67, previousClose: 333.63 },
    MSFT: { name: 'Microsoft Corporation', price: 529.76, previousClose: 529.3 },
    NVDA: { name: 'NVIDIA Corporation', price: 237.47, previousClose: 239.24 },
    AMZN: { name: 'Amazon.com, Inc.', price: 230, previousClose: 228 },
    META: { name: 'Meta Platforms, Inc.', price: 700, previousClose: 705 },
};

function quoteFor(ticker) {
    const known = prices[ticker] ?? { name: `${ticker} Inc.`, price: 100, previousClose: 100 };
    return {
        name: known.name,
        price: known.price,
        changePct: ((known.price - known.previousClose) / known.previousClose) * 100,
        weekChangePct: 1.5,
        monthChangePct: -2.5,
        volume: 12_345_678,
        currency: 'USD',
        previousClose: known.previousClose,
        marketTime: Math.floor(Date.now() / 1000),
    };
}

/** A response shaped like public/quotes.php's, for whatever tickers the page asks for. */
function quotesResponse(tickers) {
    const now = Math.floor(Date.now() / 1000);
    const quotes = {};
    const extendedQuotes = {};
    tickers.forEach((ticker) => {
        quotes[ticker] = quoteFor(ticker);
        const { price, previousClose } = quotes[ticker];
        extendedQuotes[ticker] = {
            preMarket: null,
            afterHours: null,
            activeSession: null,
            intraday: [[now - 3600, previousClose], [now - 1800, (previousClose + price) / 2], [now, price]],
        };
    });

    return {
        quotes,
        errors: {},
        extendedQuotes,
        extendedErrors: {},
        marketOpen: true,
        tradingActive: true,
        market: {
            session: 'open',
            name: 'US market',
            nextChangeLabel: 'Closes',
            nextChangeAt: now + 2 * 3600 + 5 * 60,
            nextSessionChangeAt: now + 2 * 3600 + 5 * 60,
        },
        rateLimited: false,
        fetchedAt: new Date().toISOString(),
    };
}

/** Replaces the data file with these stocks and holdings, or removes it when null. */
function writePortfolio(portfolio) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    if (portfolio !== null) {
        fs.writeFileSync(dataFile, JSON.stringify({ holdings: {}, ...portfolio }, null, 2));
    }
}

/** What the page last saved, or null when there is no data file. */
function readPortfolio() {
    return fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : null;
}

/**
 * "TICKER/list" for each saved stock in alphabetical order, e.g.
 * ['MU/owned', 'NVDA/monitor']. The order in the file follows the page's
 * sorting by today's change, which the tests do not depend on.
 */
function savedStocks() {
    const saved = readPortfolio();
    return saved ? saved.stocks.map((stock) => `${stock.ticker}/${stock.list}`).sort() : null;
}

/**
 * The Playwright test function with every page's Yahoo requests answered
 * by quotesResponse(), and failing on any JavaScript error the page shows,
 * other than ones matching the test's expectedConsoleErrors.
 */
const test = base.test.extend({
    expectedConsoleErrors: [/** @type {RegExp[]} */ ([]), { option: true }],
    page: async ({ page, expectedConsoleErrors }, use) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            const text = message.text();
            if (message.type() === 'error' && !expectedConsoleErrors.some((pattern) => pattern.test(text))) {
                errors.push(text);
            }
        });
        await page.route('**/quotes.php?*', (route) => {
            const symbols = new URL(route.request().url()).searchParams.get('symbols') ?? '';
            return route.fulfill({ json: quotesResponse(symbols.split(',').filter(Boolean)) });
        });

        await use(page);

        base.expect(errors, 'JavaScript errors on the page').toEqual([]);
    },
});

/** The tickers in one section, in the order they are shown. */
async function tickersIn(page, list) {
    return page.locator(`tbody[data-list="${list}"] tr`).evaluateAll(
        (rows) => rows.map((row) => /** @type {HTMLElement} */ (row).dataset.ticker)
    );
}

function row(page, ticker) {
    return page.locator(`tbody[data-list] tr[data-ticker="${ticker}"]`);
}

/** Adds a stock to a section with the form at the top of the page. */
async function addStock(page, ticker, list) {
    await page.locator('#new-ticker').fill(ticker);
    await page.locator('#new-list').selectOption(list);
    await page.getByRole('button', { name: 'Add stock' }).click();
}

module.exports = {
    test,
    expect: base.expect,
    writePortfolio,
    readPortfolio,
    savedStocks,
    tickersIn,
    row,
    addStock,
};
