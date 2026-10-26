// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const base = require('@playwright/test');

// The app's data folder while the tests run, and the database in it.
const dataDir = /** @type {string} */ (process.env.STOCK_PANEL_TEST_DATA_DIR);
const databaseFile = path.join(dataDir, 'database.sqlite');
// An empty database with all the app's tables, made by global-setup.js.
const templateDatabase = path.join(/** @type {string} */ (process.env.STOCK_PANEL_TEST_TEMPLATE_DIR), 'database.sqlite');

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

/** A response shaped like /quotes's (QuoteController), for whatever tickers the page asks for. */
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

/** A response shaped like /history's (HistoryController). */
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

// The password the tests log in with, and its hash as PHP's password_hash()
// made it.
const testPassword = 'test-password-123';
const testPasswordHash = '$2y$12$6AyoucMaW.Bdiea6q8dWXu5kXsr4cyb8n8mDvVfVrdELHSf8Nnnoe';

/** Opens the test database, runs `work` on it, and closes it again. */
function withDatabase(work) {
    // Waits up to 5 seconds if the app is writing to it at that moment.
    const database = new DatabaseSync(databaseFile, { timeout: 5000 });
    try {
        return work(database);
    } finally {
        database.close();
    }
}

/**
 * Empties the test database, before every test. The first time it copies the
 * empty database made by global-setup.js; after that it empties the tables
 * instead of deleting the file, which Windows refuses while the app still
 * has it open for a late request from the previous test. Each test's user
 * then gets a new id, so such a late request cannot reach its stocks.
 */
function resetDatabase() {
    if (!fs.existsSync(databaseFile)) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.copyFileSync(templateDatabase, databaseFile);
    }
    withDatabase((database) => database.exec('DELETE FROM stocks; DELETE FROM users;'));
}

/**
 * Sets up the test's data: the test password, and these stocks and holdings
 * saved. With null, nothing has been saved yet, so the page starts with the
 * built-in stocks. With withPassword false there is no user at all, so the
 * app asks for a password. Within a test the user stays the same, so a page
 * that is already logged in stays logged in.
 */
function writePortfolio(portfolio, { withPassword = true } = {}) {
    if (!withPassword && portfolio !== null) {
        throw new Error('Stocks belong to the user, so there can be none without a password.');
    }

    withDatabase((database) => {
        database.exec('DELETE FROM stocks;');
        if (!withPassword) {
            database.exec('DELETE FROM users;');
            return;
        }

        // The format Laravel stores times in, e.g. '2026-10-23 12:00:00'.
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const savedAt = portfolio === null ? null : now;
        let user = database.prepare('SELECT id FROM users').get();
        if (user) {
            database.prepare('UPDATE users SET password = ?, failed_logins = 0, locked_until = NULL, portfolio_saved_at = ? WHERE id = ?')
                .run(testPasswordHash, savedAt, user.id);
        } else {
            const inserted = database.prepare(
                'INSERT INTO users (name, password, failed_logins, portfolio_saved_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)'
            ).run('owner', testPasswordHash, savedAt, now, now);
            user = { id: inserted.lastInsertRowid };
        }

        const insertStock = database.prepare(
            'INSERT INTO stocks (user_id, ticker, list, position, shares, cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        (portfolio?.stocks ?? []).forEach((stock, position) => {
            const holding = portfolio.holdings?.[stock.ticker] ?? {};
            insertStock.run(user.id, stock.ticker, stock.list, position, holding.shares ?? null, holding.cost ?? null, now, now);
        });
    });
}

/** The password hash and the count of wrong passwords, or null when no password has been chosen. */
function readAuth() {
    const user = withDatabase((database) => database.prepare('SELECT password, failed_logins FROM users').get());
    return user ? { passwordHash: user.password, failedAttempts: user.failed_logins } : null;
}

/**
 * Logs a page or a whole browser context in with the test password. Like a
 * browser, it first opens the login page for the form's security token,
 * which Laravel checks.
 */
async function logIn(target) {
    const loginPage = await (await target.request.get('/login')).text();
    const token = /name="_token" value="([^"]+)"/.exec(loginPage)?.[1];
    const response = await target.request.post('/login', { form: { _token: token ?? '', password: testPassword }, maxRedirects: 0 });
    base.expect(response.status(), 'logging in with the test password').toBe(303);
}

/**
 * What the page last saved, in the shape it sends ({ stocks, holdings }), or
 * null when nothing has been saved yet.
 */
function readPortfolio() {
    return withDatabase((database) => {
        const user = database.prepare('SELECT id, portfolio_saved_at FROM users').get();
        if (!user || user.portfolio_saved_at === null) {
            return null;
        }

        const stocks = database.prepare('SELECT ticker, list, shares, cost FROM stocks WHERE user_id = ? ORDER BY position').all(user.id);
        const holdings = {};
        stocks
            .filter((stock) => stock.shares !== null || stock.cost !== null)
            .forEach((stock) => { holdings[stock.ticker] = { shares: stock.shares, cost: stock.cost }; });
        return { stocks: stocks.map((stock) => ({ ticker: stock.ticker, list: stock.list })), holdings };
    });
}

/**
 * "TICKER/list" for each saved stock in alphabetical order, e.g.
 * ['MU/owned', 'NVDA/monitor']. The saved order follows the page's sorting
 * by today's change, which the tests do not depend on.
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
 * requests to the app, and the live price stream.
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
    await target.route('**/quotes?*', (route) => {
        const symbols = new URL(route.request().url()).searchParams.get('symbols') ?? '';
        return route.fulfill({ json: quotesResponse(symbols.split(',').filter(Boolean)) });
    });
    await target.route('**/history?*', (route) => {
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
    // Runs at the start of every test, before its beforeEach hooks.
    freshDatabase: [async ({}, use) => {
        resetDatabase();
        await use();
    }, { auto: true }],
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
