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
            // Opened three hours ago, closes when market.nextChangeAt says.
            regularSession: [now - 3 * 3600, now + 2 * 3600 + 5 * 60],
        };
    });

    return {
        quotes,
        // A round rate, so amounts in kronor are easy to check by hand.
        fxRates: { USD: 10 },
        errors: {},
        extendedQuotes,
        extendedErrors: {},
        marketOpen: true,
        tradingActive: true,
        market: {
            session: 'open',
            name: 'US market',
            timezone: 'America/New_York',
            nextChangeLabel: 'Closes',
            nextChangeAt: now + 2 * 3600 + 5 * 60,
            nextSessionChangeAt: now + 2 * 3600 + 5 * 60,
        },
        rateLimited: false,
        fetchedAt: new Date().toISOString(),
    };
}

/**
 * Made-up closes for the large chart, per period. Only the one-day chart has
 * a previous close; longer periods compare with their first point.
 */
const history = {
    '1d': { previousClose: 1045.56, closes: [1040, 1060, 1088] },
    '1y': { previousClose: null, closes: [800, 950, 1088] },
};

/** A response shaped like public/history.php's. */
function historyResponse(symbol, range) {
    const { previousClose, closes } = history[range] ?? { previousClose: null, closes: [1000, 1088] };
    const now = Math.floor(Date.now() / 1000);
    return {
        symbol,
        range,
        currency: 'USD',
        previousClose,
        points: closes.map((close, index) => [now - (closes.length - 1 - index) * 3600, close]),
    };
}

/** Replaces the data file with these stocks and holdings, or removes it when null. */
// The password the tests log in with, and its hash as PHP's password_hash()
// made it.
const testPassword = 'test-password-123';
const testPasswordHash = '$2y$12$6AyoucMaW.Bdiea6q8dWXu5kXsr4cyb8n8mDvVfVrdELHSf8Nnnoe';
const authFile = path.join(dataDir, 'auth.json');

/**
 * Replaces the data file with these stocks and holdings, or removes it when
 * null. The test password is set up again too, unless withPassword is false.
 */
function writePortfolio(portfolio, { withPassword = true } = {}) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    if (portfolio !== null) {
        fs.writeFileSync(dataFile, JSON.stringify({ holdings: {}, ...portfolio }, null, 2));
    }
    if (withPassword) {
        fs.writeFileSync(authFile, JSON.stringify({ passwordHash: testPasswordHash, failedAttempts: 0, lockedUntil: 0 }));
    }
}

/** What auth.json holds, or null when there is none. */
function readAuth() {
    return fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, 'utf8')) : null;
}

/** Logs a page or a whole browser context in with the test password. */
async function logIn(target) {
    const response = await target.request.post('/login.php', { form: { password: testPassword }, maxRedirects: 0 });
    base.expect(response.status(), 'logging in with the test password').toBe(303);
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
 * Encodes a price update the way Yahoo's stream does: a protobuf
 * PricingData message, base64-encoded. marketHours: 0 pre-market,
 * 1 regular, 2 after-hours.
 */
function encodePricingData({ ticker, price, time = Date.now(), marketHours = 1, changePercent = null }) {
    const bytes = [];
    const varint = (number) => {
        let value = BigInt(number);
        while (value > 127n) {
            bytes.push(Number(value & 127n) | 128);
            value >>= 7n;
        }
        bytes.push(Number(value));
    };
    const tag = (field, wireType) => varint((field << 3) | wireType);
    const float = (field, number) => {
        const buffer = Buffer.alloc(4);
        buffer.writeFloatLE(number);
        tag(field, 5);
        bytes.push(...buffer);
    };

    const id = Buffer.from(ticker);
    tag(1, 2);
    varint(id.length);
    bytes.push(...id);
    float(2, price);
    tag(3, 0);
    varint(BigInt(time) << 1n); // zigzag encoding of a positive number
    tag(7, 0);
    varint(marketHours);
    if (changePercent !== null) {
        float(8, changePercent);
    }
    return Buffer.from(bytes).toString('base64');
}

/**
 * A stand-in for Yahoo's live price stream. Tests can send trades with
 * send(), see what the page subscribed to, and make the stream refuse
 * connections or drop them.
 */
function createStream() {
    const stream = {
        connections: [],
        // How many times the page has connected, including reconnections.
        connectionCount: 0,
        subscribed: new Set(),
        refuse: false,
        send(update) {
            const text = JSON.stringify({ type: 'pricing', message: encodePricingData(update) });
            stream.connections.forEach((connection) => connection.send(text));
        },
        dropAll() {
            stream.subscribed.clear();
            stream.connections.splice(0).forEach((connection) => connection.close({ code: 1001 }));
        },
    };
    return stream;
}

/**
 * Answers a page's (or a whole browser context's) requests to Yahoo with
 * made-up data, so tests never touch the network: quote and history
 * requests through the app's PHP endpoints, and the live price stream.
 */
async function stubYahoo(target, stream) {
    await target.routeWebSocket(/streamer\.finance\.yahoo\.com/, (connection) => {
        stream.connectionCount += 1;
        if (stream.refuse) {
            connection.close({ code: 1011 });
            return;
        }
        stream.connections.push(connection);
        connection.onMessage((message) => {
            const request = JSON.parse(String(message));
            (request.subscribe ?? []).forEach((ticker) => stream.subscribed.add(ticker));
            (request.unsubscribe ?? []).forEach((ticker) => stream.subscribed.delete(ticker));
        });
    });
    await target.route('**/quotes.php?*', (route) => {
        const symbols = new URL(route.request().url()).searchParams.get('symbols') ?? '';
        return route.fulfill({ json: quotesResponse(symbols.split(',').filter(Boolean)) });
    });
    await target.route('**/history.php?*', (route) => {
        const params = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: historyResponse(params.get('symbol'), params.get('range')) });
    });
}

/**
 * The Playwright test function with every page's Yahoo requests answered
 * by quotesResponse() and its live stream replaced by the `stream` fixture,
 * failing on any JavaScript error the page shows, other than ones matching
 * the test's expectedConsoleErrors.
 */
const test = base.test.extend({
    expectedConsoleErrors: [/** @type {RegExp[]} */ ([]), { option: true }],
    // Whether each test starts logged in; the login tests turn this off.
    loggedIn: [true, { option: true }],
    stream: async ({}, use) => {
        await use(createStream());
    },
    page: async ({ page, expectedConsoleErrors, stream, loggedIn }, use) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            const text = message.text();
            if (message.type() === 'error' && !expectedConsoleErrors.some((pattern) => pattern.test(text))) {
                errors.push(text);
            }
        });
        await stubYahoo(page, stream);
        if (loggedIn) {
            await logIn(page);
        }

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
    testPassword,
    readAuth,
    logIn,
    quotesResponse,
    createStream,
    stubYahoo,
    writePortfolio,
    readPortfolio,
    savedStocks,
    tickersIn,
    row,
    addStock,
};
