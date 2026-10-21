const addStockForm = document.getElementById('add-stock-form');
const tickerInput = document.getElementById('new-ticker');
const listSelect = document.getElementById('new-list');
const stockBodies = Array.from(document.querySelectorAll('tbody[data-list]'));
const status = document.getElementById('watchlist-status');
const refreshButton = document.getElementById('refresh-quotes');
const refreshCountdown = document.getElementById('refresh-countdown');
// Older versions kept everything in the browser under these keys. They are
// only read once, to move that data into data/portfolio.json.
const legacyStocksKey = 'stock-panel-added-tickers';
const legacyHoldingsKey = 'stock-panel-holdings';
const legacyMigratedKey = 'stock-panel-moved-to-data-file';
const holdings = new Map();
const saveStatus = document.getElementById('save-status');
const typingSaveDelayMs = 600;
const saveRetryDelayMs = 10_000;
let saveTimer = null;
let saveInFlight = false;
let saveAgain = false;
let saveBlocked = false;
const portfolioSummary = document.getElementById('portfolio-summary');
const portfolioCost = document.getElementById('portfolio-cost');
const portfolioValue = document.getElementById('portfolio-value');
const portfolioGain = document.getElementById('portfolio-gain');
const portfolioDay = document.getElementById('portfolio-day');
const portfolioValueSek = document.getElementById('portfolio-value-sek');
const portfolioDaySek = document.getElementById('portfolio-day-sek');
const fxNote = document.getElementById('fx-note');
// Exchange rates to Swedish kronor, e.g. { USD: 9.97 }, from the latest refresh.
let fxRates = {};
const allocationPanel = document.getElementById('allocation-panel');
const allocationList = document.getElementById('allocation-list');
const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;
const listNames = {
    owned: 'My current stocks',
    monitor: 'Stocks to monitor',
};
const maxStocks = 25;
const svgNamespace = 'http://www.w3.org/2000/svg';
const sparklineWidth = 120;
const sparklineHeight = 40;
const sparklineInset = 3;
const chartState = new WeakMap();
const chartTooltip = document.createElement('div');
chartTooltip.className = 'chart-tooltip';
chartTooltip.hidden = true;
document.body.append(chartTooltip);
const marketOpenRefreshMs = 5_000;
const extendedHoursRefreshMs = 15_000;
const marketClosedRefreshMs = 120_000;
// While live prices stream in, the rest (volume, charts, week and month,
// market hours) only needs refreshing once a minute.
const streamingRefreshMs = 60_000;
// A stream with no trades for this long while the market is open is treated
// as broken: polling takes over and the stream reconnects.
const streamQuietLimitMs = 30_000;
// The refresh rate the market session calls for when there is no stream.
let pollingRefreshMs = marketOpenRefreshMs;
let priceStream = null;
let streamState = 'connecting';
let streamRenderTimer = null;
const streamStatus = document.getElementById('stream-status');
const streamStatusText = document.getElementById('stream-status-text');
const maxRefreshMs = 120_000;
const maxBackoffLevel = 4;
let baseRefreshMs = marketOpenRefreshMs;
let backoffLevel = 0;
let refreshIntervalMs = marketOpenRefreshMs;
const marketStatus = document.getElementById('market-status');
const marketStatusLabel = document.getElementById('market-status-label');
const marketStatusCountdown = document.getElementById('market-status-countdown');
const sessionLabels = {
    open: 'Market open',
    preMarket: 'Pre-market',
    afterHours: 'After-hours',
    closed: 'Market closed',
};
let marketState = null;
const removeDialog = document.getElementById('remove-dialog');
const removeDialogTitle = document.getElementById('remove-dialog-title');
const removeDialogMessage = document.getElementById('remove-dialog-message');
let pendingRemoval = null;
let isRefreshing = false;
let refreshQueued = false;
let nextRefreshAt = Date.now() + refreshIntervalMs;
let lastRefreshEndedAt = 0;

// The next refresh comes one interval after the last one ended, or right as
// the next market session starts or ends if that is sooner, so a long
// closed-market wait never delays the first pre-market prices. Called again
// when the interval changes, e.g. when the live stream connects or drops.
function scheduleNextRefresh() {
    nextRefreshAt = (lastRefreshEndedAt || Date.now()) + refreshIntervalMs;
    const nextChangeMs = marketState && Number.isFinite(marketState.nextSessionChangeAt)
        ? marketState.nextSessionChangeAt * 1000 + 1000
        : NaN;
    if (nextChangeMs > Date.now()) {
        nextRefreshAt = Math.min(nextRefreshAt, nextChangeMs);
    }
    updateRefreshCountdown();
}

// When the login has run out (or ended in another tab), the server answers
// 401: go to the login page, which says why.
function sendToLoginIfLoggedOut(response) {
    if (response.status !== 401) {
        return false;
    }
    window.location.assign('login.php?expired=1');
    return true;
}

function allRows() {
    return stockBodies.flatMap((body) => Array.from(body.querySelectorAll('tr')));
}

function findRow(ticker) {
    return document.querySelector(`tbody[data-list] tr[data-ticker="${CSS.escape(ticker)}"]`);
}

function bodyFor(list) {
    return stockBodies.find((body) => body.dataset.list === list);
}

function updateEmptyStates() {
    stockBodies.forEach((body) => {
        const isEmpty = body.rows.length === 0;
        document.getElementById(`${body.dataset.list}-empty`).hidden = !isEmpty;
        body.closest('.table-wrap').hidden = isEmpty;
    });
    syncLiveCharts();
}

function nonNegativeNumber(value) {
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function setHoldings(savedHoldings) {
    Object.entries(savedHoldings || {}).forEach(([ticker, holding]) => {
        if (tickerPattern.test(ticker) && holding && typeof holding === 'object') {
            holdings.set(ticker, {
                shares: nonNegativeNumber(holding.shares),
                cost: nonNegativeNumber(holding.cost),
            });
        }
    });
}

function showSaveStatus(message, isError = false) {
    saveStatus.textContent = message;
    saveStatus.classList.toggle('is-error', isError);
}

// What gets saved to data/portfolio.json: every stock with its section, and
// the shares and costs of the stocks still on the page.
function portfolioState() {
    const stocks = allRows().map((row) => ({
        ticker: row.dataset.ticker,
        list: row.closest('tbody').dataset.list,
    }));
    const tickers = new Set(stocks.map((stock) => stock.ticker));

    return {
        stocks,
        holdings: Object.fromEntries(Array.from(holdings).filter(([ticker]) => tickers.has(ticker))),
    };
}

// Saves shortly after a change; typing waits a moment so that every
// keystroke does not write the file.
function scheduleSave(delayMs = 0) {
    if (saveBlocked) {
        return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(savePortfolio, delayMs);
}

async function savePortfolio() {
    saveTimer = null;
    if (saveInFlight) {
        saveAgain = true;
        return;
    }

    saveInFlight = true;
    showSaveStatus('Saving...');
    try {
        const response = await fetch('data.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(portfolioState()),
            cache: 'no-store',
        });
        if (sendToLoginIfLoggedOut(response)) {
            return;
        }
        let result = {};
        try {
            result = await response.json();
        } catch (error) {
            // The error below covers a response that is not JSON.
        }
        if (!response.ok) {
            throw new Error(result.error || `The server returned HTTP ${response.status}.`);
        }

        const savedAt = new Date(result.savedAt || Date.now()).toLocaleTimeString();
        showSaveStatus(`All changes saved to data/portfolio.json at ${savedAt}.`);
        markBrowserDataMoved();
    } catch (error) {
        showSaveStatus(`Your latest changes are not saved yet: ${error.message} Trying again in ${saveRetryDelayMs / 1000} seconds.`, true);
        if (saveTimer === null) {
            scheduleSave(saveRetryDelayMs);
        }
    } finally {
        saveInFlight = false;
        if (saveAgain) {
            saveAgain = false;
            savePortfolio();
        }
    }
}

function createHoldingInputCell(field, value, label) {
    const cell = document.createElement('td');
    cell.className = 'holding-cell';

    const input = document.createElement('input');
    input.className = 'holding-input';
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.placeholder = '—';
    input.dataset.field = field;
    input.setAttribute('aria-label', label);
    if (value !== null && value !== undefined) {
        input.value = String(value);
    }

    cell.append(input);
    return cell;
}

function formatSignedPrice(value, currency) {
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${formatPrice(Math.abs(value), currency)}`;
}

function rowPrice(row) {
    return row.dataset.regularPrice ? Number(row.dataset.regularPrice) : NaN;
}

function renderHolding(row) {
    const costTotalCell = row.querySelector('.holding-cost-total');
    const valueCell = row.querySelector('.holding-value');
    const gainCell = row.querySelector('.holding-gain');
    if (!costTotalCell || !valueCell || !gainCell) {
        return;
    }

    const holding = holdings.get(row.dataset.ticker);
    const price = rowPrice(row);
    const currency = row.dataset.currency || 'USD';
    costTotalCell.textContent = holding && Number.isFinite(holding.shares) && Number.isFinite(holding.cost)
        ? formatPrice(holding.shares * holding.cost, currency)
        : '—';
    renderDayGain(row, holding, price, currency);
    gainCell.classList.remove('trend', 'up', 'down');
    if (!holding || !Number.isFinite(holding.shares) || !Number.isFinite(price)) {
        valueCell.textContent = '—';
        gainCell.textContent = '—';
        return;
    }

    valueCell.textContent = formatPrice(holding.shares * price, currency);
    if (!Number.isFinite(holding.cost)) {
        gainCell.textContent = '—';
        return;
    }

    const gain = (price - holding.cost) * holding.shares;
    const gainPct = holding.cost > 0 ? ((price - holding.cost) / holding.cost) * 100 : null;
    gainCell.textContent = gainPct === null
        ? formatSignedPrice(gain, currency)
        : `${formatSignedPrice(gain, currency)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)`;
    gainCell.classList.add('trend');
    gainCell.classList.toggle('up', gain > 0);
    gainCell.classList.toggle('down', gain < 0);
}

// How much this holding has gained or lost in money since yesterday's close.
function renderDayGain(row, holding, price, currency) {
    const cell = row.querySelector('.holding-day-gain');
    if (!cell) {
        return;
    }

    const previousClose = row.dataset.previousClose ? Number(row.dataset.previousClose) : NaN;
    cell.classList.remove('trend', 'up', 'down');
    if (!holding || !Number.isFinite(holding.shares) || !Number.isFinite(price) || !Number.isFinite(previousClose)) {
        cell.textContent = '—';
        return;
    }

    const dayGain = holding.shares * (price - previousClose);
    cell.textContent = formatSignedPrice(dayGain, currency);
    cell.classList.add('trend');
    cell.classList.toggle('up', dayGain > 0);
    cell.classList.toggle('down', dayGain < 0);
}

function renderPortfolioSummary() {
    if (!portfolioSummary) {
        return;
    }

    // Totals are kept per currency so stocks priced in different currencies
    // are never added together.
    const totals = new Map();
    const positions = [];
    bodyFor('owned').querySelectorAll('tr').forEach((row) => {
        const holding = holdings.get(row.dataset.ticker);
        const price = rowPrice(row);
        if (!holding || !Number.isFinite(holding.shares) || !Number.isFinite(price)) {
            return;
        }

        const currency = row.dataset.currency || 'USD';
        const total = totals.get(currency) || {
            value: 0,
            cost: 0,
            valueWithCost: 0,
            hasCost: false,
            dayChange: 0,
            previousValue: 0,
            hasDayChange: false,
        };
        total.value += holding.shares * price;
        positions.push({ ticker: row.dataset.ticker, value: holding.shares * price, currency });
        if (Number.isFinite(holding.cost)) {
            total.cost += holding.shares * holding.cost;
            total.valueWithCost += holding.shares * price;
            total.hasCost = true;
        }
        const previousClose = row.dataset.previousClose ? Number(row.dataset.previousClose) : NaN;
        if (Number.isFinite(previousClose)) {
            total.dayChange += holding.shares * (price - previousClose);
            total.previousValue += holding.shares * previousClose;
            total.hasDayChange = true;
        }
        totals.set(currency, total);
    });

    portfolioSummary.hidden = totals.size === 0;
    portfolioCost.textContent = Array.from(totals)
        .filter(([, total]) => total.hasCost)
        .map(([currency, total]) => formatPrice(total.cost, currency))
        .join(' · ') || '—';
    portfolioValue.textContent = Array.from(totals, ([currency, total]) => formatPrice(total.value, currency)).join(' · ') || '—';

    renderChangeParts(portfolioDay, Array.from(totals)
        .filter(([, total]) => total.hasDayChange)
        .map(([currency, total]) => [currency, total.dayChange, total.previousValue]));
    renderChangeParts(portfolioGain, Array.from(totals)
        .filter(([, total]) => total.hasCost)
        .map(([currency, total]) => [currency, total.valueWithCost - total.cost, total.cost]));
    renderSekAmounts(totals);
    renderAllocation(positions);
}

// Shows the total value and today's change in Swedish kronor, converted at
// today's exchange rates. Cost and gain stay in the stocks' own currency:
// converting them correctly needs the rate on the day each stock was bought.
function renderSekAmounts(totals) {
    const currencies = Array.from(totals.keys());
    const rateFor = (currency) => (currency === 'SEK' ? 1 : fxRates[currency]);
    const canConvert = currencies.length > 0
        && currencies.some((currency) => currency !== 'SEK')
        && currencies.every((currency) => Number.isFinite(rateFor(currency)));

    portfolioValueSek.hidden = !canConvert;
    portfolioDaySek.hidden = !canConvert;
    fxNote.hidden = !canConvert;
    if (!canConvert) {
        return;
    }

    let valueSek = 0;
    let dayChangeSek = 0;
    totals.forEach((total, currency) => {
        valueSek += total.value * rateFor(currency);
        dayChangeSek += total.dayChange * rateFor(currency);
    });

    portfolioValueSek.textContent = `≈ ${formatSek(valueSek)}`;
    const sign = dayChangeSek > 0 ? '+' : dayChangeSek < 0 ? '-' : '';
    portfolioDaySek.textContent = `≈ ${sign}${formatSek(Math.abs(dayChangeSek))}`;
    portfolioDaySek.classList.toggle('up', dayChangeSek > 0);
    portfolioDaySek.classList.toggle('down', dayChangeSek < 0);

    const rates = currencies
        .filter((currency) => currency !== 'SEK')
        .map((currency) => `1 ${currency} = ${rateFor(currency).toFixed(4)} SEK`);
    fxNote.textContent = `Amounts in kronor use today's exchange rate: ${rates.join(', ')}. Cost and gain stay in the stocks' own currency.`;
}

function formatSek(amount) {
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'SEK',
        maximumFractionDigits: 0,
    }).format(amount);
}

// Lists each holding's share of the portfolio, largest first, with a bar
// scaled to the largest holding. Holdings in different currencies are
// listed in separate groups because their values cannot be compared.
function renderAllocation(positions) {
    if (!allocationPanel) {
        return;
    }

    allocationPanel.hidden = positions.length === 0;
    const groups = new Map();
    positions.forEach((position) => {
        groups.set(position.currency, [...(groups.get(position.currency) || []), position]);
    });

    const elements = [];
    groups.forEach((items, currency) => {
        if (groups.size > 1) {
            const heading = document.createElement('p');
            heading.className = 'allocation-currency';
            heading.textContent = currency;
            elements.push(heading);
        }

        items.sort((a, b) => b.value - a.value);
        const total = items.reduce((sum, item) => sum + item.value, 0);
        const largest = items[0].value;
        items.forEach((item) => {
            const share = total > 0 ? (item.value / total) * 100 : 0;

            const ticker = document.createElement('span');
            ticker.className = 'allocation-ticker';
            ticker.textContent = item.ticker;

            const track = document.createElement('span');
            track.className = 'allocation-track';
            track.setAttribute('aria-hidden', 'true');
            const bar = document.createElement('span');
            bar.className = 'allocation-bar';
            bar.style.width = `${largest > 0 ? (item.value / largest) * 100 : 0}%`;
            track.append(bar);

            const shareText = document.createElement('span');
            shareText.className = 'allocation-share';
            shareText.textContent = `${share.toFixed(1)}%`;

            const value = document.createElement('span');
            value.className = 'allocation-value';
            value.textContent = formatPrice(item.value, currency);

            elements.push(ticker, track, shareText, value);
        });
    });
    allocationList.replaceChildren(...elements);
}

// Shows one colored "+$12.34 (+1.23%)" entry per currency, where each entry
// is [currency, change, base the percentage is measured against].
function renderChangeParts(element, entries) {
    const parts = [];
    entries.forEach(([currency, change, base]) => {
        const changePct = base > 0 ? (change / base) * 100 : null;
        const part = document.createElement('span');
        part.className = `trend${change > 0 ? ' up' : change < 0 ? ' down' : ''}`;
        part.textContent = changePct === null
            ? formatSignedPrice(change, currency)
            : `${formatSignedPrice(change, currency)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
        if (parts.length > 0) {
            parts.push(' · ');
        }
        parts.push(part);
    });
    element.replaceChildren(...(parts.length > 0 ? parts : ['—']));
}

function formatDuration(ms) {
    if (ms < 60_000) {
        return `${Math.max(1, Math.ceil(ms / 1000))}s`;
    }

    const totalMinutes = Math.ceil(ms / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function renderMarketStatus() {
    if (!marketState) {
        marketStatus.hidden = true;
        return;
    }

    marketStatus.hidden = false;
    marketStatus.dataset.session = marketState.session;
    marketStatusLabel.textContent = sessionLabels[marketState.session];

    const remainingMs = marketState.nextChangeAt * 1000 - Date.now();
    const nextChange = remainingMs > 0
        ? `${marketState.nextChangeLabel.toLowerCase()} in ${formatDuration(remainingMs)}`
        : 'updating...';
    marketStatusCountdown.textContent = `${marketState.name} · ${nextChange}`;
}

// Slows refreshing down while Yahoo is rate-limiting or failing, doubling
// the wait each time, and returns to the normal rate after a clean refresh.
function applyBackoff(slowDown) {
    backoffLevel = slowDown ? Math.min(backoffLevel + 1, maxBackoffLevel) : 0;
    updateRefreshRate();
}

function updateRefreshRate() {
    baseRefreshMs = streamIsLive() ? Math.max(pollingRefreshMs, streamingRefreshMs) : pollingRefreshMs;
    refreshIntervalMs = Math.min(baseRefreshMs * 2 ** backoffLevel, maxRefreshMs);
}

// The stream counts as working when it is connected and, while the market is
// open, has delivered a trade recently.
function streamIsQuiet() {
    return marketState?.session === 'open' && Date.now() - priceStream.lastActivityAt() > streamQuietLimitMs;
}

function streamIsLive() {
    return Boolean(priceStream?.isLive()) && !streamIsQuiet();
}

function renderStreamStatus() {
    const shownState = streamIsLive() ? 'live' : streamState === 'live' ? 'quiet' : streamState;
    streamStatus.dataset.state = shownState;
    streamStatusText.textContent = {
        live: 'Live prices: updated the moment a trade happens.',
        quiet: 'Live prices have gone quiet, so prices are checked regularly while the stream reconnects.',
        connecting: 'Connecting to live prices...',
        down: 'Live prices are unavailable right now, so prices are checked regularly instead. Retrying automatically.',
    }[shownState];
}

function handleStreamStateChange(state) {
    streamState = state;
    updateRefreshRate();
    // Sooner when the stream drops, later when it connects.
    if (!isRefreshing) {
        scheduleNextRefresh();
    }
    renderStreamStatus();
    if (statusShowsRefreshNote) {
        showRefreshNote();
    }
}

function syncStreamTickers() {
    priceStream?.setTickers(allRows().map((row) => row.dataset.ticker));
}

function flashPrice(cell, rose) {
    cell.classList.remove('flash-up', 'flash-down');
    // Reading the layout restarts the animation when the class comes back.
    void cell.offsetWidth;
    cell.classList.add(rose ? 'flash-up' : 'flash-down');
}

// Re-sorting and the portfolio totals follow streamed prices at most once a
// second, so a burst of trades does not make the page jump around.
function scheduleStreamRender() {
    if (streamRenderTimer !== null) {
        return;
    }
    streamRenderTimer = window.setTimeout(() => {
        streamRenderTimer = null;
        sortRowsByDayChange();
        renderPortfolioSummary();
    }, 1000);
}

// A trade from the live stream. During regular hours it updates the price,
// today's change and the holding; before and after hours it updates the
// pre-market or after-hours note under the price.
function applyStreamPrice(update) {
    const row = findRow(update.ticker);
    if (!row) {
        return;
    }

    const currency = row.dataset.currency || 'USD';
    if (update.session !== 'regular') {
        const sessionQuote = { price: update.price };
        renderExtendedQuote(row, { activeSession: update.session, preMarket: sessionQuote, afterHours: sessionQuote }, currency);
        return;
    }

    const previousPrice = rowPrice(row);
    const priceCell = row.querySelector('.quote-price');
    row.dataset.regularPrice = String(update.price);
    row.dataset.streamTime = String(update.time || Date.now());
    // The first trade of a new day turns 'Yesterday' into 'Today'.
    latestRegularTradeTime = Math.max(latestRegularTradeTime ?? 0, (update.time || Date.now()) / 1000);
    renderDayLabels();
    priceCell.textContent = formatPrice(update.price, currency);

    const previousClose = row.dataset.previousClose ? Number(row.dataset.previousClose) : NaN;
    const changePct = Number.isFinite(previousClose) && previousClose !== 0
        ? ((update.price - previousClose) / previousClose) * 100
        : update.changePercent;
    row.dataset.changePct = Number.isFinite(changePct) ? String(changePct) : '';
    renderPercentChange(row.querySelector('.quote-change'), changePct);
    renderHolding(row);

    const extendedNote = row.querySelector('.extended-hours-value');
    extendedNote.textContent = '';
    extendedNote.classList.remove('up', 'down');

    if (Number.isFinite(previousPrice) && update.price !== previousPrice) {
        flashPrice(priceCell, update.price > previousPrice);
    }
    addLiveChartTrade(update.ticker, update.time || Date.now(), update.price);
    scheduleStreamRender();
}

function describeRefreshInterval() {
    const seconds = Math.round(refreshIntervalMs / 1000);
    if (seconds >= 60 && seconds % 60 === 0) {
        const minutes = seconds / 60;
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${seconds} seconds`;
}

// The latest successful refresh, so its note can be rewritten when the
// refresh rate changes (e.g. the stream connects) before the next refresh.
let lastRefresh = null;
let statusShowsRefreshNote = false;

function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
    statusShowsRefreshNote = false;
}

function showRefreshNote() {
    const { updatedAt, sessionNote } = lastRefresh;
    const rate = streamIsLive()
        ? `prices stream live; other figures refresh every ${describeRefreshInterval()}.`
        : `refreshing every ${describeRefreshInterval()}.`;
    showStatus(`Prices updated at ${updatedAt} from Yahoo Finance. ${sessionNote}: ${rate}`);
    statusShowsRefreshNote = true;
}

function updateRefreshCountdown() {
    if (document.visibilityState === 'hidden') {
        refreshCountdown.textContent = 'Refresh paused while this page is hidden';
    } else if (isRefreshing) {
        refreshCountdown.textContent = 'Updating prices...';
    } else {
        const secondsRemaining = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
        refreshCountdown.textContent = `Next refresh in ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'}`;
    }
}

function createCell(className) {
    const cell = document.createElement('td');
    cell.className = className;
    return cell;
}

function createSpan(className, text = '—') {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
}

function createButton(className, action, text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.textContent = text;
    return button;
}

// Builds a stock's table row. Several columns hold two values, with the
// second one as a small note underneath, so that the table fits on the
// screen without scrolling sideways.
function addTickerRow(ticker, list, name = null) {
    const row = document.createElement('tr');
    row.dataset.ticker = ticker;
    const holding = holdings.get(ticker) || {};

    const stockCell = createCell('stock-cell');
    const tickerButton = createButton('ticker-button', 'chart', ticker);
    tickerButton.title = `Open a larger chart of ${ticker}`;
    stockCell.append(tickerButton, createSpan('quote-name', name || '—'));

    const sharesCell = createHoldingInputCell('shares', holding.shares, `Shares of ${ticker} you own`);
    const costCell = createHoldingInputCell('cost', holding.cost, `Average price you paid per ${ticker} share`);
    costCell.append(createSpan('cell-note holding-cost-total'));

    const priceCell = createCell('price-cell');
    priceCell.append(createSpan('quote-price'), createSpan('cell-note extended-hours-value', ''));

    const valueCell = createCell('holding-cell');
    valueCell.append(createSpan('holding-value'));
    const gainCell = createCell('holding-cell');
    gainCell.append(createSpan('holding-gain'));

    const dayCell = createCell('day-cell');
    dayCell.append(createSpan('quote-change'), createSpan('cell-note holding-cell holding-day-gain'));

    const chartCell = createCell('quote-chart col-chart');
    chartCell.textContent = '—';

    const periodCell = createCell('period-cell');
    [['W', 'Week', 'quote-week'], ['M', 'Month', 'quote-month']].forEach(([label, title, className]) => {
        const line = createSpan('period-line', '');
        const abbreviation = document.createElement('abbr');
        abbreviation.className = 'period-label';
        abbreviation.title = title;
        abbreviation.textContent = label;
        line.append(abbreviation, createSpan(className));
        periodCell.append(line);
    });

    const volumeCell = createCell('col-volume');
    volumeCell.append(createSpan('quote-volume'));

    const actionCell = createCell('action-cell');
    const removeButton = createButton('remove-stock-button', 'remove', '✕');
    removeButton.title = 'Remove';
    removeButton.setAttribute('aria-label', `Remove ${ticker}`);
    actionCell.append(removeButton);

    row.append(stockCell, sharesCell, costCell, priceCell, valueCell, gainCell, dayCell, chartCell, periodCell, volumeCell, actionCell);
    bodyFor(list).append(row);
}

function formatVolume(volume) {
    if (!Number.isFinite(volume)) {
        return '—';
    }

    return new Intl.NumberFormat(undefined, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(volume);
}

function formatPrice(price, currency) {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currency || 'USD',
        }).format(price);
    } catch (error) {
        return `${currency || 'USD'} ${price.toFixed(2)}`;
    }
}

function renderQuote(row, quote) {
    const nameCell = row.querySelector('.quote-name');
    const priceCell = row.querySelector('.quote-price');
    const changeCell = row.querySelector('.quote-change');
    const weekCell = row.querySelector('.quote-week');
    const monthCell = row.querySelector('.quote-month');
    const volumeCell = row.querySelector('.quote-volume');

    nameCell.textContent = quote.name || row.dataset.ticker;
    // Long names are cut short to keep the column narrow; this shows them in full.
    nameCell.title = nameCell.textContent;

    // A price from the live stream that is newer than this quote is kept.
    const streamTime = Number(row.dataset.streamTime || 0);
    const quoteTime = Number.isFinite(quote.marketTime) ? quote.marketTime * 1000 : 0;
    const keepStreamPrice = streamTime > quoteTime && Number.isFinite(rowPrice(row));
    const price = keepStreamPrice ? rowPrice(row) : quote.price;
    const changePct = keepStreamPrice && Number.isFinite(quote.previousClose) && quote.previousClose !== 0
        ? ((price - quote.previousClose) / quote.previousClose) * 100
        : quote.changePct;

    row.dataset.currency = quote.currency || 'USD';
    row.dataset.regularPrice = Number.isFinite(price) ? String(price) : '';
    row.dataset.previousClose = Number.isFinite(quote.previousClose) ? String(quote.previousClose) : '';
    row.dataset.changePct = Number.isFinite(changePct) ? String(changePct) : '';
    priceCell.textContent = Number.isFinite(price)
        ? formatPrice(price, quote.currency)
        : '—';

    renderPercentChange(changeCell, changePct);
    renderPercentChange(weekCell, quote.weekChangePct);
    renderPercentChange(monthCell, quote.monthChangePct);

    volumeCell.textContent = formatVolume(quote.volume);
}

function renderExtendedQuote(row, extendedQuote, currency) {
    const element = row.querySelector('.extended-hours-value');
    if (!element) {
        return;
    }

    element.classList.remove('up', 'down');
    const session = extendedQuote.activeSession;
    const quote = session === 'preMarket'
        ? extendedQuote.preMarket
        : session === 'afterHours'
            ? extendedQuote.afterHours
            : null;

    // Shown under the price only while pre-market or after-hours trading is on.
    if (!quote || !Number.isFinite(quote.price)) {
        element.textContent = '';
        return;
    }

    const regularPriceValue = element.closest('tr').dataset.regularPrice;
    const regularPrice = regularPriceValue === '' ? NaN : Number(regularPriceValue);
    const changePct = Number.isFinite(regularPrice) && regularPrice !== 0
        ? ((quote.price - regularPrice) / regularPrice) * 100
        : null;
    const changeText = Number.isFinite(changePct)
        ? ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`
        : '';

    element.textContent = `${session === 'preMarket' ? 'Pre-market' : 'After-hours'}: ${formatPrice(quote.price, currency)}${changeText}`;
    if (Number.isFinite(changePct)) {
        element.classList.toggle('up', changePct > 0);
        element.classList.toggle('down', changePct < 0);
    } else {
        element.classList.remove('up', 'down');
    }
}

function createSvgElement(name, attributes) {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
}

function renderSparkline(row, points, previousClose, currency) {
    const cell = row.querySelector('.quote-chart');
    if (!cell) {
        return;
    }

    const validPoints = Array.isArray(points)
        ? points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        : [];
    if (validPoints.length < 2) {
        chartState.delete(cell);
        cell.textContent = '—';
        return;
    }

    const prices = validPoints.map((point) => point[1]);
    const hasBaseline = Number.isFinite(previousClose);
    let low = Math.min(...prices, ...(hasBaseline ? [previousClose] : []));
    let high = Math.max(...prices, ...(hasBaseline ? [previousClose] : []));
    const padding = (high - low) * 0.08 || Math.abs(high) * 0.01 || 1;
    low -= padding;
    high += padding;

    const firstTime = validPoints[0][0];
    const timeSpan = validPoints[validPoints.length - 1][0] - firstTime || 1;
    const x = (time) => sparklineInset + ((time - firstTime) / timeSpan) * (sparklineWidth - sparklineInset * 2);
    const y = (price) => sparklineHeight - sparklineInset - ((price - low) / (high - low)) * (sparklineHeight - sparklineInset * 2);

    const lastPrice = prices[prices.length - 1];
    const reference = hasBaseline ? previousClose : prices[0];
    const trend = lastPrice > reference ? 'up' : lastPrice < reference ? 'down' : 'flat';

    const svg = createSvgElement('svg', {
        class: `sparkline ${trend}`,
        viewBox: `0 0 ${sparklineWidth} ${sparklineHeight}`,
        width: sparklineWidth,
        height: sparklineHeight,
        role: 'img',
        'aria-label': `${row.dataset.ticker} today: ${formatPrice(prices[0], currency)} to ${formatPrice(lastPrice, currency)}`,
    });

    if (hasBaseline) {
        svg.append(createSvgElement('line', {
            class: 'sparkline-baseline',
            x1: 0,
            x2: sparklineWidth,
            y1: y(previousClose),
            y2: y(previousClose),
        }));
    }

    const path = validPoints
        .map(([time, price], index) => `${index === 0 ? 'M' : 'L'}${x(time).toFixed(1)},${y(price).toFixed(1)}`)
        .join(' ');
    svg.append(createSvgElement('path', { class: 'sparkline-line', d: path }));

    const hoverLine = createSvgElement('line', {
        class: 'sparkline-hover-line',
        y1: 0,
        y2: sparklineHeight,
        visibility: 'hidden',
    });
    const hoverDot = createSvgElement('circle', {
        class: 'sparkline-hover-dot',
        r: 3,
        visibility: 'hidden',
    });
    svg.append(hoverLine, hoverDot);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sparkline-button';
    button.dataset.action = 'chart';
    button.setAttribute('aria-label', `Open a larger chart of ${row.dataset.ticker}`);
    button.append(svg);
    cell.replaceChildren(button);
    chartState.set(cell, { points: validPoints, x, y, currency, hoverLine, hoverDot });

    if (!cell.dataset.hoverBound) {
        cell.dataset.hoverBound = 'true';
        cell.addEventListener('pointermove', showChartHover);
        cell.addEventListener('pointerleave', hideChartHover);
    }
}

function showChartHover(event) {
    const cell = event.currentTarget;
    const chart = chartState.get(cell);
    const svg = cell.querySelector('svg');
    if (!chart || !svg) {
        return;
    }

    const bounds = svg.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left) * (sparklineWidth / bounds.width);
    let nearest = chart.points[0];
    chart.points.forEach((point) => {
        if (Math.abs(chart.x(point[0]) - pointerX) < Math.abs(chart.x(nearest[0]) - pointerX)) {
            nearest = point;
        }
    });

    const pointX = chart.x(nearest[0]);
    const pointY = chart.y(nearest[1]);
    chart.hoverLine.setAttribute('x1', pointX);
    chart.hoverLine.setAttribute('x2', pointX);
    chart.hoverLine.setAttribute('visibility', 'visible');
    chart.hoverDot.setAttribute('cx', pointX);
    chart.hoverDot.setAttribute('cy', pointY);
    chart.hoverDot.setAttribute('visibility', 'visible');

    const time = new Date(nearest[0] * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    chartTooltip.textContent = `${time} · ${formatPrice(nearest[1], chart.currency)}`;
    chartTooltip.style.left = `${bounds.left + (pointX / sparklineWidth) * bounds.width}px`;
    chartTooltip.style.top = `${bounds.top - 6}px`;
    chartTooltip.hidden = false;
}

function hideChartHover(event) {
    const chart = chartState.get(event.currentTarget);
    if (chart) {
        chart.hoverLine.setAttribute('visibility', 'hidden');
        chart.hoverDot.setAttribute('visibility', 'hidden');
    }
    chartTooltip.hidden = true;
}

// Today's graphs: one card per stock in My current stocks, drawn across the
// whole regular session and moved along by every live trade.
const liveChartsPanel = document.getElementById('live-charts-panel');
const liveChartsList = document.getElementById('live-charts');
// Room on the right for price labels and at the bottom for times. The graph
// is drawn at its size on screen, so the text stays the same size; this
// width is only used before the card is laid out.
const liveChart = { width: 560, left: 2, right: 64, top: 12, bottom: 26 };
// Trades from the stream are kept one per this many seconds until the next
// refresh brings the day's points from Yahoo.
const liveTradeBucketSeconds = 10;
const liveCharts = new Map();
// Every stock's points and trading hours from the last refresh, so a stock
// moved into My current stocks gets its graph without waiting for the next.
const dayCharts = new Map();
let liveChartCount = 0;

// Gives each stock in My current stocks a card, in the same order as the
// table, and removes the cards of stocks that left it.
function syncLiveCharts() {
    const tickers = Array.from(bodyFor('owned').rows, (row) => row.dataset.ticker);
    liveCharts.forEach((chart, ticker) => {
        if (!tickers.includes(ticker)) {
            chart.card.remove();
            liveCharts.delete(ticker);
        }
    });
    tickers.forEach((ticker) => {
        if (!liveCharts.has(ticker)) {
            liveCharts.set(ticker, createLiveChart(ticker));
            const saved = dayCharts.get(ticker);
            if (saved) {
                setLiveChartData(ticker, saved.points, saved.session);
            }
        }
    });

    const cards = tickers.map((ticker) => liveCharts.get(ticker).card);
    if (cards.some((card, index) => liveChartsList.children[index] !== card)) {
        liveChartsList.append(...cards);
    }
    liveChartsPanel.hidden = cards.length === 0;
}

function createLiveChart(ticker) {
    const card = document.createElement('article');
    card.className = 'live-chart-card';
    card.dataset.ticker = ticker;

    const titles = document.createElement('div');
    titles.className = 'live-chart-titles';
    const tickerButton = createButton('ticker-button live-chart-ticker', 'chart', ticker);
    tickerButton.title = `Open a larger chart of ${ticker}`;
    const name = createSpan('live-chart-name', '');
    titles.append(tickerButton, name);

    const quote = document.createElement('div');
    quote.className = 'live-chart-quote';
    const price = createSpan('live-chart-price');
    const change = createSpan('live-chart-change');
    const when = createSpan('live-chart-when', '');
    quote.append(price, change, when);

    const header = document.createElement('div');
    header.className = 'live-chart-header';
    header.append(titles, quote);

    const plot = document.createElement('div');
    plot.className = 'live-chart-plot';
    plot.append(createSpan('live-chart-empty', 'Loading...'));
    card.append(header, plot);

    liveChartCount += 1;
    const chart = {
        ticker,
        card,
        name,
        price,
        change,
        when,
        plot,
        gradientId: `live-chart-fill-${liveChartCount}`,
        // The day's points from the last refresh, and trades since then.
        points: [],
        livePoints: [],
        session: null,
        // What was last drawn, for pointing at the graph.
        drawn: null,
        pointerX: null,
        frame: null,
    };
    plot.addEventListener('pointermove', (event) => {
        chart.pointerX = event.clientX;
        showLiveChartHover(chart);
    });
    plot.addEventListener('pointerleave', () => {
        chart.pointerX = null;
        showLiveChartHover(chart);
    });
    return chart;
}

// The day's points and trading hours from a refresh. Trades from the stream
// that are newer than its last point stay on the graph.
function setLiveChartData(ticker, points, session) {
    dayCharts.set(ticker, { points, session });
    const chart = liveCharts.get(ticker);
    if (!chart) {
        return;
    }

    chart.points = Array.isArray(points)
        ? points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        : [];
    chart.session = Array.isArray(session) && session.length === 2 && session.every(Number.isFinite) && session[1] > session[0]
        ? session
        : null;
    const lastTime = chart.points.length > 0 ? chart.points[chart.points.length - 1][0] : -Infinity;
    chart.livePoints = chart.livePoints.filter(([time]) => time > lastTime);
    scheduleLiveChartDraw(chart);
}

// A regular-hours trade from the stream: the end of the line moves to it.
function addLiveChartTrade(ticker, timeMs, price) {
    const chart = liveCharts.get(ticker);
    if (!chart) {
        return;
    }

    const time = timeMs / 1000;
    const all = [...chart.points, ...chart.livePoints];
    const lastTime = all.length > 0 ? all[all.length - 1][0] : -Infinity;
    const inSession = !chart.session || (time >= chart.session[0] && time < chart.session[1]);
    // A trade from another day (before the next refresh brings its hours),
    // or one that arrives after a newer one, only updates the price above.
    if (inSession && time >= lastTime) {
        const last = chart.livePoints[chart.livePoints.length - 1];
        if (last && Math.floor(last[0] / liveTradeBucketSeconds) === Math.floor(time / liveTradeBucketSeconds)) {
            chart.livePoints[chart.livePoints.length - 1] = [time, price];
        } else {
            chart.livePoints.push([time, price]);
        }
    }
    scheduleLiveChartDraw(chart);
}

// Draws at most once per frame, however many trades arrive.
function scheduleLiveChartDraw(chart) {
    if (chart.frame !== null) {
        return;
    }
    chart.frame = window.requestAnimationFrame(() => {
        chart.frame = null;
        if (liveCharts.get(chart.ticker) === chart) {
            drawLiveChart(chart);
        }
    });
}

function liveChartContext(chart) {
    const row = findRow(chart.ticker);
    const previousClose = row?.dataset.previousClose ? Number(row.dataset.previousClose) : NaN;
    return {
        currency: row?.dataset.currency || 'USD',
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
        price: row ? rowPrice(row) : NaN,
        name: row?.querySelector('.quote-name')?.textContent ?? '',
    };
}

// The price, change and time above the graph: the latest price, or the
// price at the point being pointed at.
function renderLiveChartQuote(chart, point) {
    const { currency, previousClose, price: latestPrice } = liveChartContext(chart);
    const price = point ? point[1] : latestPrice;
    chart.price.textContent = Number.isFinite(price) ? formatPrice(price, currency) : '—';

    if (Number.isFinite(price) && previousClose !== null) {
        const change = price - previousClose;
        chart.change.textContent = describeChange(change, previousClose, currency);
        chart.change.className = `live-chart-change trend ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`;
    } else {
        chart.change.textContent = '';
        chart.change.className = 'live-chart-change';
    }

    if (point) {
        chart.when.textContent = `at ${new Date(point[0] * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        const points = [...chart.points, ...chart.livePoints];
        const lastTime = points.length > 0 ? points[points.length - 1][0] : latestRegularTradeTime;
        chart.when.textContent = sessionDayName(lastTime);
    }
}

// Full hours across the session, e.g. 16:00, 18:00, 20:00, 22:00, in the
// browser's time zone like the rest of the page.
function liveChartTimeTicks(start, end) {
    const hours = (end - start) / 3600;
    const step = hours > 8 ? 3 : hours > 4 ? 2 : 1;
    const ticks = [];
    const date = new Date(start * 1000);
    date.setMinutes(0, 0, 0);
    while (date.getTime() / 1000 <= end) {
        const time = date.getTime() / 1000;
        if (time >= start && date.getHours() % step === 0) {
            ticks.push(time);
        }
        date.setHours(date.getHours() + 1);
    }
    return ticks.length > 0 ? ticks : [start, end];
}

function drawLiveChart(chart) {
    const { currency, previousClose, name } = liveChartContext(chart);
    chart.name.textContent = name === '—' ? '' : name;
    chart.name.title = chart.name.textContent;

    const points = [...chart.points, ...chart.livePoints];
    if (points.length < 2) {
        chart.drawn = null;
        chart.card.classList.remove('up', 'down');
        chart.plot.replaceChildren(createSpan('live-chart-empty', 'No trades yet today.'));
        renderLiveChartQuote(chart, null);
        return;
    }

    const { left, right, top, bottom } = liveChart;
    const width = Math.round(chart.plot.clientWidth) || liveChart.width;
    const height = Math.round(chart.plot.clientHeight) || 200;
    const plotRight = width - right;
    const plotBottom = height - bottom;
    const prices = points.map((point) => point[1]);
    const lastPoint = points[points.length - 1];
    const baseline = previousClose ?? prices[0];
    const trend = lastPoint[1] > baseline ? 'up' : lastPoint[1] < baseline ? 'down' : 'flat';
    chart.card.classList.toggle('up', trend === 'up');
    chart.card.classList.toggle('down', trend === 'down');

    const references = previousClose !== null ? [previousClose] : [];
    const { ticks, step } = niceTicks(Math.min(...prices, ...references), Math.max(...prices, ...references), 4);
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    // The whole session, so the line fills in from left to right as the day goes on.
    const start = chart.session ? Math.min(chart.session[0], points[0][0]) : points[0][0];
    const end = chart.session ? Math.max(chart.session[1], lastPoint[0]) : lastPoint[0];
    const x = (time) => left + ((time - start) / (end - start)) * (plotRight - left);
    const y = (price) => top + (1 - (price - low) / (high - low)) * (plotBottom - top);
    const axisPrice = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: step < 1 ? 2 : 0,
        maximumFractionDigits: step < 1 ? 2 : 0,
    });

    const svg = createSvgElement('svg', {
        class: `live-chart ${trend}`,
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': `${chart.ticker} ${sessionDayName(lastPoint[0]).toLowerCase()}: from ${formatPrice(prices[0], currency)} to ${formatPrice(lastPoint[1], currency)}`,
    });

    const gradient = createSvgElement('linearGradient', { id: chart.gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(
        createSvgElement('stop', { class: 'live-chart-fill-top', offset: 0 }),
        createSvgElement('stop', { class: 'live-chart-fill-bottom', offset: 1 }),
    );
    const defs = createSvgElement('defs', {});
    defs.append(gradient);
    svg.append(defs);

    ticks.forEach((tick) => {
        svg.append(createSvgElement('line', { class: 'live-chart-grid', x1: left, x2: plotRight, y1: y(tick), y2: y(tick) }));
        const label = createSvgElement('text', { class: 'live-chart-axis', x: plotRight + 8, y: y(tick), 'dominant-baseline': 'middle' });
        label.textContent = axisPrice.format(tick);
        svg.append(label);
    });

    liveChartTimeTicks(start, end).forEach((time) => {
        const position = x(time);
        const anchor = position - left < 24 ? 'start' : plotRight - position < 24 ? 'end' : 'middle';
        const label = createSvgElement('text', { class: 'live-chart-axis', x: position, y: height - 6, 'text-anchor': anchor });
        label.textContent = new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        svg.append(label);
    });

    const linePath = points.map(([time, price], index) => `${index === 0 ? 'M' : 'L'}${x(time).toFixed(1)},${y(price).toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${x(lastPoint[0]).toFixed(1)},${plotBottom} L${x(points[0][0]).toFixed(1)},${plotBottom} Z`;
    svg.append(createSvgElement('path', { class: 'live-chart-area', d: areaPath, fill: `url(#${chart.gradientId})` }));

    if (previousClose !== null) {
        svg.append(createSvgElement('line', { class: 'live-chart-previous-close', x1: left, x2: plotRight, y1: y(previousClose), y2: y(previousClose) }));
    }

    svg.append(createSvgElement('path', { class: 'live-chart-line', d: linePath }));

    // The newest price, pulsing while the session is still going.
    const sessionOngoing = chart.session !== null && Date.now() / 1000 < chart.session[1];
    const lastX = x(lastPoint[0]);
    const lastY = y(lastPoint[1]);
    if (sessionOngoing) {
        svg.append(createSvgElement('circle', { class: 'live-chart-pulse', cx: lastX, cy: lastY, r: 4 }));
    }
    svg.append(createSvgElement('circle', { class: 'live-chart-last', cx: lastX, cy: lastY, r: 4 }));

    const hoverLine = createSvgElement('line', { class: 'live-chart-hover-line', y1: top, y2: plotBottom, visibility: 'hidden' });
    const hoverDot = createSvgElement('circle', { class: 'live-chart-hover-dot', r: 4, visibility: 'hidden' });
    svg.append(hoverLine, hoverDot);

    chart.plot.replaceChildren(svg);
    chart.drawn = { svg, width, points, x, y, start, end, hoverLine, hoverDot };
    showLiveChartHover(chart);
}

// While the pointer is over a graph, marks the nearest point and shows its
// price and time above it; otherwise shows the latest price.
function showLiveChartHover(chart) {
    const drawn = chart.drawn;
    if (!drawn || chart.pointerX === null) {
        drawn?.hoverLine.setAttribute('visibility', 'hidden');
        drawn?.hoverDot.setAttribute('visibility', 'hidden');
        renderLiveChartQuote(chart, null);
        return;
    }

    const { left, right } = liveChart;
    const { width } = drawn;
    const bounds = drawn.svg.getBoundingClientRect();
    const pointerX = ((chart.pointerX - bounds.left) / bounds.width) * width;
    const time = drawn.start + ((pointerX - left) / (width - right - left)) * (drawn.end - drawn.start);
    let nearest = drawn.points[0];
    drawn.points.forEach((point) => {
        if (Math.abs(point[0] - time) < Math.abs(nearest[0] - time)) {
            nearest = point;
        }
    });

    const pointX = drawn.x(nearest[0]);
    drawn.hoverLine.setAttribute('x1', pointX);
    drawn.hoverLine.setAttribute('x2', pointX);
    drawn.hoverDot.setAttribute('cx', pointX);
    drawn.hoverDot.setAttribute('cy', drawn.y(nearest[1]));
    drawn.hoverLine.setAttribute('visibility', 'visible');
    drawn.hoverDot.setAttribute('visibility', 'visible');
    renderLiveChartQuote(chart, nearest);
}

// The large chart: price history for one stock over a chosen period, opened
// by clicking a stock's ticker or small chart.
const chartDialog = document.getElementById('chart-dialog');
const chartDialogTitle = document.getElementById('chart-dialog-title');
const chartDialogName = document.getElementById('chart-dialog-name');
const chartDialogChange = document.getElementById('chart-dialog-change');
const chartDialogPlot = document.getElementById('chart-dialog-plot');
const chartDialogTooltip = document.getElementById('chart-dialog-tooltip');
const chartDialogStatus = document.getElementById('chart-dialog-status');
const rangeButtons = Array.from(chartDialog.querySelectorAll('[data-range]'));
const rangeDescriptions = { '1d': 'today', '1w': 'past week', '1m': 'past month', '1y': 'past year', '5y': 'past 5 years' };

// 'Today', 'Yesterday' or the weekday (e.g. 'Friday') of the trading day a
// timestamp (in seconds) belongs to, counted in the exchange's time zone.
// Before the market opens, prices and charts are still the previous
// session's, which over a weekend is Friday's.
function sessionDayName(timestamp) {
    const timeZone = marketState?.timezone;
    if (!Number.isFinite(timestamp) || typeof timeZone !== 'string') {
        return 'Today';
    }

    let dayOf;
    try {
        const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        dayOf = (milliseconds) => format.format(milliseconds);
    } catch (error) {
        return 'Today';
    }
    const sessionDay = dayOf(timestamp * 1000);
    if (sessionDay === dayOf(Date.now())) {
        return 'Today';
    }
    if (sessionDay === dayOf(Date.now() - 86_400_000)) {
        return 'Yesterday';
    }
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(timestamp * 1000);
}

// When the latest regular-hours trade happened (seconds). Until the market
// opens, prices, the Day column and the day totals are yesterday's.
let latestRegularTradeTime = null;

// Names the Day column and the day total after the trading day the prices
// come from: 'Today', or 'Yesterday' / 'Friday' before the market opens.
function renderDayLabels() {
    const name = sessionDayName(latestRegularTradeTime);
    document.querySelectorAll('.day-label').forEach((label) => {
        label.textContent = name;
    });
}
// Room on the left for price labels and on the right for line labels.
const largeChart = { width: 900, height: 360, left: 76, right: 150, top: 16, bottom: 34 };
let largeChartTicker = null;
let largeChartRequest = 0;

function openLargeChart(ticker) {
    largeChartTicker = ticker;
    chartDialogTitle.textContent = ticker;
    const name = findRow(ticker)?.querySelector('.quote-name')?.textContent ?? '';
    chartDialogName.textContent = name === '—' ? '' : name;
    chartDialog.showModal();
    loadLargeChart('1d');
}

async function loadLargeChart(range) {
    rangeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.range === range)));
    const request = ++largeChartRequest;
    chartDialogPlot.querySelector('svg')?.remove();
    chartDialogTooltip.hidden = true;
    chartDialogChange.textContent = '';
    chartDialogStatus.classList.remove('is-error');
    chartDialogStatus.textContent = 'Loading...';

    try {
        const response = await fetch(`history.php?symbol=${encodeURIComponent(largeChartTicker)}&range=${range}`, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        if (sendToLoginIfLoggedOut(response)) {
            return;
        }
        let result = {};
        try {
            result = await response.json();
        } catch (error) {
            // The error below covers a response that is not JSON.
        }
        if (!response.ok) {
            throw new Error(result.error || `The server returned HTTP ${response.status}.`);
        }
        // A newer request (another period, or another stock) replaced this one.
        if (request !== largeChartRequest) {
            return;
        }

        const points = (Array.isArray(result.points) ? result.points : [])
            .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
        if (points.length < 2) {
            chartDialogStatus.textContent = range === '1d'
                ? 'No trades yet today. Regular trading starts at 9:30 New York time.'
                : 'No price history is available for this period.';
            return;
        }

        chartDialogStatus.textContent = '';
        drawLargeChart(points, Number.isFinite(result.previousClose) ? result.previousClose : null, result.currency || 'USD', range);
    } catch (error) {
        if (request === largeChartRequest) {
            chartDialogStatus.textContent = `Could not load the chart: ${error.message}`;
            chartDialogStatus.classList.add('is-error');
        }
    }
}

// Round, evenly spaced axis values covering low to high, e.g. 1,000 / 1,025 / 1,050.
function niceTicks(low, high, count) {
    if (low === high) {
        low -= 1;
        high += 1;
    }
    const roughStep = (high - low) / (count - 1);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= roughStep);
    // Start at or below low and keep going until high is covered.
    const ticks = [Number((Math.floor(low / step) * step).toPrecision(12))];
    while (ticks[ticks.length - 1] < high) {
        ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
    }
    return { ticks, step };
}

function formatChartTime(timestamp, range, detailed) {
    const date = new Date(timestamp * 1000);
    switch (range) {
        case '1d':
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case '1w':
            return detailed
                ? date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
        case '1m':
            return detailed
                ? date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
        case '1y':
            return detailed
                ? date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
                : date.toLocaleDateString([], { month: 'short', year: '2-digit' });
        default:
            return detailed
                ? date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
                : date.toLocaleDateString([], { month: 'short', year: 'numeric' });
    }
}

function describeChange(change, base, currency) {
    const sign = change > 0 ? '+' : change < 0 ? '-' : '';
    const percent = base !== 0 ? ` (${sign}${Math.abs((change / base) * 100).toFixed(2)}%)` : '';
    return `${sign}${formatPrice(Math.abs(change), currency)}${percent}`;
}

function drawLargeChart(points, previousClose, currency, range) {
    const { width, height, left, right, top, bottom } = largeChart;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const prices = points.map((point) => point[1]);
    const lastPrice = prices[prices.length - 1];
    // The one-day chart compares with yesterday's close, longer ones with
    // their first point.
    const baseline = previousClose ?? prices[0];

    const row = findRow(largeChartTicker);
    const holding = holdings.get(largeChartTicker);
    const averageCost = row?.closest('tbody')?.dataset.list === 'owned' && Number.isFinite(holding?.cost) && holding.cost > 0
        ? holding.cost
        : null;

    // e.g. 'today', 'yesterday' or 'on Friday' for the one-day chart.
    const dayName = sessionDayName(points[points.length - 1][0]);
    const periodDescription = range !== '1d'
        ? rangeDescriptions[range]
        : ['Today', 'Yesterday'].includes(dayName) ? dayName.toLowerCase() : `on ${dayName}`;

    const references = [previousClose, averageCost].filter(Number.isFinite);
    const { ticks, step } = niceTicks(Math.min(...prices, ...references), Math.max(...prices, ...references), 5);
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    // Points are spaced evenly, so nights and weekends take no room.
    const x = (index) => left + (index / (points.length - 1)) * plotWidth;
    const y = (price) => top + (1 - (price - low) / (high - low)) * plotHeight;
    const axisPrice = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: step < 1 ? 2 : 0,
        maximumFractionDigits: step < 1 ? 2 : 0,
    });

    const trend = lastPrice > baseline ? 'up' : lastPrice < baseline ? 'down' : 'flat';
    const svg = createSvgElement('svg', {
        class: `large-chart ${trend}`,
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': `${largeChartTicker} ${periodDescription}: from ${formatPrice(prices[0], currency)} to ${formatPrice(lastPrice, currency)}`,
    });

    ticks.forEach((tick) => {
        svg.append(createSvgElement('line', { class: 'large-chart-grid', x1: left, x2: left + plotWidth, y1: y(tick), y2: y(tick) }));
        const label = createSvgElement('text', { class: 'large-chart-axis', x: left - 10, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' });
        label.textContent = axisPrice.format(tick);
        svg.append(label);
    });

    const labelCount = Math.min(5, points.length);
    for (let label = 0; label < labelCount; label += 1) {
        const index = Math.round((label * (points.length - 1)) / (labelCount - 1));
        const anchor = label === 0 ? 'start' : label === labelCount - 1 ? 'end' : 'middle';
        const text = createSvgElement('text', { class: 'large-chart-axis', x: x(index), y: height - 10, 'text-anchor': anchor });
        text.textContent = formatChartTime(points[index][0], range, false);
        svg.append(text);
    }

    const referenceLine = (price, className, text) => {
        svg.append(createSvgElement('line', { class: className, x1: left, x2: left + plotWidth, y1: y(price), y2: y(price) }));
        const label = createSvgElement('text', { class: 'large-chart-reference-label', x: left + plotWidth + 8, y: y(price), 'dominant-baseline': 'middle' });
        label.textContent = `${text} ${formatPrice(price, currency)}`;
        svg.append(label);
    };
    if (Number.isFinite(previousClose)) {
        referenceLine(previousClose, 'large-chart-previous-close', 'Prev close');
    }
    if (averageCost !== null) {
        referenceLine(averageCost, 'large-chart-average-cost', 'Your avg');
    }

    const path = points.map(([, price], index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(price).toFixed(1)}`).join(' ');
    svg.append(createSvgElement('path', { class: 'large-chart-line', d: path }));

    const hoverLine = createSvgElement('line', { class: 'large-chart-hover-line', y1: top, y2: top + plotHeight, visibility: 'hidden' });
    const hoverDot = createSvgElement('circle', { class: 'large-chart-hover-dot', r: 4, visibility: 'hidden' });
    // A transparent layer over the plot that catches the pointer anywhere,
    // not only on the thin line.
    const hitArea = createSvgElement('rect', { class: 'large-chart-hit-area', x: left, y: top, width: plotWidth, height: plotHeight });
    svg.append(hoverLine, hoverDot, hitArea);

    hitArea.addEventListener('pointermove', (event) => {
        const bounds = svg.getBoundingClientRect();
        const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
        const index = Math.max(0, Math.min(points.length - 1, Math.round(((pointerX - left) / plotWidth) * (points.length - 1))));
        const [timestamp, price] = points[index];

        hoverLine.setAttribute('x1', x(index));
        hoverLine.setAttribute('x2', x(index));
        hoverDot.setAttribute('cx', x(index));
        hoverDot.setAttribute('cy', y(price));
        hoverLine.setAttribute('visibility', 'visible');
        hoverDot.setAttribute('visibility', 'visible');

        chartDialogTooltip.replaceChildren(
            Object.assign(document.createElement('strong'), { textContent: formatPrice(price, currency) }),
            Object.assign(document.createElement('span'), { textContent: formatChartTime(timestamp, range, true) }),
        );
        const plotBounds = chartDialogPlot.getBoundingClientRect();
        chartDialogTooltip.style.left = `${bounds.left - plotBounds.left + (x(index) / width) * bounds.width}px`;
        chartDialogTooltip.style.top = `${bounds.top - plotBounds.top + (y(price) / height) * bounds.height}px`;
        chartDialogTooltip.hidden = false;
    });
    hitArea.addEventListener('pointerleave', () => {
        hoverLine.setAttribute('visibility', 'hidden');
        hoverDot.setAttribute('visibility', 'hidden');
        chartDialogTooltip.hidden = true;
    });

    chartDialogPlot.prepend(svg);
    chartDialogChange.textContent = `${describeChange(lastPrice - baseline, baseline, currency)} ${periodDescription}`;
    chartDialogChange.className = `chart-dialog-change trend ${trend}`;
}

function dayChangeOf(row) {
    const changePct = row.dataset.changePct ? Number(row.dataset.changePct) : NaN;
    return Number.isFinite(changePct) ? changePct : -Infinity;
}

// Orders each table by today's change, best first; stocks without a quote
// stay at the bottom in their current order.
function sortRowsByDayChange() {
    stockBodies.forEach((body) => {
        // Moving a row would take focus away from a field being edited.
        if (body.contains(document.activeElement)) {
            return;
        }

        const rows = Array.from(body.rows);
        const sorted = [...rows].sort((a, b) => {
            const changeA = dayChangeOf(a);
            const changeB = dayChangeOf(b);
            return changeA === changeB ? 0 : changeB > changeA ? 1 : -1;
        });
        if (sorted.some((row, index) => row !== rows[index])) {
            body.append(...sorted);
        }
    });
    syncLiveCharts();
}

function renderPercentChange(cell, changePct) {
    if (Number.isFinite(changePct)) {
        const positive = changePct >= 0;
        cell.textContent = `${positive ? '+' : ''}${changePct.toFixed(2)}%`;
        cell.classList.add('trend');
        cell.classList.toggle('up', positive);
        cell.classList.toggle('down', !positive);
        return;
    }

    cell.textContent = '—';
    cell.classList.remove('trend', 'up', 'down');
}

async function refreshQuotes() {
    if (isRefreshing) {
        refreshQueued = true;
        return;
    }
    if (document.visibilityState === 'hidden') {
        return;
    }

    const tickers = Array.from(new Set(allRows().map((row) => row.dataset.ticker).filter(Boolean)));
    if (tickers.length === 0) {
        return;
    }

    isRefreshing = true;
    refreshButton.disabled = true;
    refreshButton.textContent = 'Updating...';
    updateRefreshCountdown();

    try {
        const response = await fetch(`quotes.php?symbols=${encodeURIComponent(tickers.join(','))}`, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        if (sendToLoginIfLoggedOut(response)) {
            return;
        }
        const responseBody = await response.text();
        let result;
        try {
            result = JSON.parse(responseBody);
        } catch (error) {
            throw new Error(`Quote endpoint returned a non-JSON response (HTTP ${response.status}). Check the PHP server error log for the underlying error.`);
        }

        if (!response.ok) {
            throw new Error(result.error || `Quote service returned HTTP ${response.status}.`);
        }

        // Known before the refresh rate is worked out, since whether the
        // stream counts as working depends on whether the market is open.
        const market = result.market;
        marketState = market && Object.hasOwn(sessionLabels, market.session) && Number.isFinite(market.nextChangeAt)
            ? market
            : null;

        pollingRefreshMs = result.marketOpen
            ? marketOpenRefreshMs
            : result.tradingActive
                ? extendedHoursRefreshMs
                : marketClosedRefreshMs;
        applyBackoff(Boolean(result.rateLimited));
        const sessionNote = result.marketOpen
            ? 'Market open'
            : result.tradingActive
                ? 'Pre-market or after-hours trading'
                : 'Market closed';
        renderMarketStatus();

        // Keep the last known rates if this refresh could not get them.
        fxRates = { ...fxRates, ...(result.fxRates || {}) };

        Object.entries(result.quotes || {}).forEach(([ticker, quote]) => {
            const row = findRow(ticker);
            if (row) {
                renderQuote(row, quote);
                renderHolding(row);
            }
        });
        sortRowsByDayChange();
        renderPortfolioSummary();
        Object.entries(result.extendedQuotes || {}).forEach(([ticker, quote]) => {
            const row = findRow(ticker);
            if (row) {
                const currency = row.dataset.currency || 'USD';
                const previousClose = row.dataset.previousClose ? Number(row.dataset.previousClose) : NaN;
                renderExtendedQuote(row, quote, currency);
                renderSparkline(row, quote.intraday, previousClose, currency);
                setLiveChartData(ticker, quote.intraday, quote.regularSession);
            }
        });
        // Also the graphs without new points, for their price and name.
        liveCharts.forEach(scheduleLiveChartDraw);
        Object.values(result.quotes || {}).forEach((quote) => {
            if (Number.isFinite(quote.marketTime)) {
                latestRegularTradeTime = Math.max(latestRegularTradeTime ?? 0, quote.marketTime);
            }
        });
        renderDayLabels();

        const failures = Object.keys(result.errors || {});
        const extendedFailures = Object.keys(result.extendedErrors || {});
        const updatedAt = new Date(result.fetchedAt || Date.now()).toLocaleTimeString();
        if (result.rateLimited) {
            showStatus(`Yahoo Finance is limiting requests, so prices now refresh every ${describeRefreshInterval()} until it recovers.`, true);
        } else if (failures.length > 0) {
            showStatus(`Updated ${Object.keys(result.quotes || {}).length} quote(s) at ${updatedAt}; unavailable: ${failures.join(', ')}.`, true);
        } else if (extendedFailures.length > 0) {
            showStatus(`Prices updated at ${updatedAt}, but extended-hours data is unavailable for: ${extendedFailures.join(', ')}.`, true);
        } else {
            lastRefresh = { updatedAt, sessionNote };
            showRefreshNote();
        }
    } catch (error) {
        applyBackoff(true);
        showStatus(`Could not refresh prices: ${error.message} Trying again in ${describeRefreshInterval()}.`, true);
    } finally {
        isRefreshing = false;
        refreshButton.disabled = false;
        refreshButton.textContent = 'Refresh prices';
        lastRefreshEndedAt = Date.now();
        scheduleNextRefresh();
        if (refreshQueued) {
            refreshQueued = false;
            refreshQuotes();
        }
    }
}

let browserDataToMark = false;

// Remembers that this browser's old data now lives in the data file, so it is
// not copied in again if the file is ever deleted. The old data itself is
// left in place as a backup.
function markBrowserDataMoved() {
    if (!browserDataToMark) {
        return;
    }

    browserDataToMark = false;
    try {
        localStorage.setItem(legacyMigratedKey, new Date().toISOString());
    } catch (error) {
        // Not being able to set the marker only risks a repeat copy later.
    }
}

// Reads what older versions saved in this browser. The saved shares and
// costs go straight into the holdings; the saved stock lists are returned so
// they can be applied once the starting rows exist.
function readBrowserData() {
    const nothing = { found: false, stocks: null };
    let savedStocks = null;
    let savedHoldings = null;
    try {
        if (localStorage.getItem(legacyMigratedKey)) {
            return nothing;
        }
        savedStocks = localStorage.getItem(legacyStocksKey);
        savedHoldings = localStorage.getItem(legacyHoldingsKey);
    } catch (error) {
        return nothing;
    }
    if (!savedStocks && !savedHoldings) {
        return nothing;
    }

    try {
        setHoldings(JSON.parse(savedHoldings || '{}'));
    } catch (error) {
        showStatus('The shares and costs saved in this browser could not be read, so they were not copied to the data file.', true);
    }

    browserDataToMark = true;
    return { found: true, stocks: savedStocks };
}

// The old browser format listed the stocks added on top of the built-in ones,
// with their section, and the built-in ones that were removed. The oldest
// format was a plain list of added tickers.
function applyBrowserStocks(savedWatchlist) {
    const added = Array.isArray(savedWatchlist) ? savedWatchlist : savedWatchlist.added;
    const removed = Array.isArray(savedWatchlist) ? [] : savedWatchlist.removed;
    if (!Array.isArray(added) || !Array.isArray(removed)) {
        throw new Error('Saved watchlist data is invalid.');
    }

    allRows().forEach((row) => {
        if (removed.includes(row.dataset.ticker)) {
            row.remove();
        }
    });

    const placed = new Set();
    added.forEach((value) => {
        // Plain ticker strings were in the section now called My current stocks.
        const entry = typeof value === 'string' ? { ticker: value, list: 'owned' } : value;
        if (!entry || typeof entry.ticker !== 'string') {
            return;
        }

        const ticker = entry.ticker.trim().toUpperCase();
        const list = Object.hasOwn(listNames, entry.list) ? entry.list : 'owned';
        if (!tickerPattern.test(ticker) || placed.has(ticker)) {
            return;
        }

        placed.add(ticker);
        const existingRow = findRow(ticker);
        if (existingRow) {
            bodyFor(list).append(existingRow);
        } else if (allRows().length < maxStocks) {
            addTickerRow(ticker, list);
        }
    });
}

// Sets up the stocks the page was loaded with, and on the very first visit
// copies in anything older versions saved in this browser before writing
// the data file for the first time.
function initializeStocks() {
    let pageData = { isNew: false, holdings: {} };
    try {
        pageData = JSON.parse(document.getElementById('portfolio-data').textContent);
    } catch (error) {
        // Saving now would overwrite the file without the holdings, so don't.
        saveBlocked = true;
        showSaveStatus('The saved data could not be read from the page, so changes will not be saved. Reload the page to try again.', true);
    }
    setHoldings(pageData.holdings);
    // Holdings come first, so that each row is built with its shares and cost.
    const browserData = pageData.isNew ? readBrowserData() : { found: false, stocks: null };

    (Array.isArray(pageData.stocks) ? pageData.stocks : []).forEach((stock) => {
        if (stock && tickerPattern.test(stock.ticker) && Object.hasOwn(listNames, stock.list)) {
            addTickerRow(stock.ticker, stock.list, stock.name);
        }
    });

    if (browserData.stocks) {
        try {
            applyBrowserStocks(JSON.parse(browserData.stocks));
        } catch (error) {
            showStatus('The stock lists saved in this browser could not be read, so they were not copied to the data file.', true);
        }
    }
    updateEmptyStates();

    if (pageData.isNew) {
        if (browserData.found) {
            showSaveStatus('Copying the stocks, shares and costs saved in this browser to data/portfolio.json...');
        }
        scheduleSave();
    }
}

stockBodies.forEach((body) => body.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    const chartButton = target.closest('button[data-action="chart"]');
    if (chartButton) {
        openLargeChart(chartButton.closest('tr').dataset.ticker);
        return;
    }

    const button = target.closest('button[data-action="remove"]');
    if (!button) {
        return;
    }

    const row = button.closest('tr');
    const ticker = row.dataset.ticker;
    const listName = listNames[body.dataset.list];
    const holding = holdings.get(ticker);
    const hasHolding = Boolean(holding && (Number.isFinite(holding.shares) || Number.isFinite(holding.cost)));

    pendingRemoval = { row, ticker, listName, button };
    removeDialogTitle.textContent = `Remove ${ticker}?`;
    removeDialogMessage.textContent = hasHolding
        ? `${ticker} will be removed from ${listName}, and the shares and average cost you entered for it will be deleted.`
        : `${ticker} will be removed from ${listName}.`;
    removeDialog.returnValue = '';
    removeDialog.showModal();
}));

removeDialog.addEventListener('close', () => {
    const removal = pendingRemoval;
    pendingRemoval = null;
    if (!removal) {
        return;
    }
    if (removeDialog.returnValue !== 'confirm' || !removal.row.isConnected) {
        removal.button.focus();
        return;
    }

    const { row, ticker, listName } = removal;
    holdings.delete(ticker);
    row.remove();
    syncStreamTickers();
    updateEmptyStates();
    renderPortfolioSummary();
    scheduleSave();
    showStatus(`${ticker} removed from ${listName}.`);
    tickerInput.focus();
});

addStockForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const ticker = tickerInput.value.trim().toUpperCase();
    const list = listSelect.value;
    if (!tickerPattern.test(ticker)) {
        showStatus('Enter a valid ticker using up to 10 letters, numbers, dots or hyphens.', true);
        return;
    }
    if (!Object.hasOwn(listNames, list)) {
        showStatus('Choose which section to add the stock to.', true);
        return;
    }

    const existingRow = findRow(ticker);
    if (existingRow) {
        const existingList = existingRow.closest('tbody').dataset.list;
        if (existingList === list) {
            showStatus(`${ticker} is already in ${listNames[list]}.`, true);
            return;
        }

        bodyFor(list).append(existingRow);
        sortRowsByDayChange();
        updateEmptyStates();
        renderPortfolioSummary();
        scheduleSave();
        tickerInput.value = '';
        showStatus(`${ticker} moved from ${listNames[existingList]} to ${listNames[list]}.`);
        return;
    }
    if (allRows().length >= maxStocks) {
        showStatus(`You can track up to ${maxStocks} stocks in total.`, true);
        return;
    }

    addTickerRow(ticker, list);
    syncStreamTickers();
    updateEmptyStates();
    scheduleSave();
    tickerInput.value = '';
    showStatus(`${ticker} added to ${listNames[list]}. Fetching its latest price...`);
    refreshQuotes();
});

stockBodies.forEach((body) => body.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('holding-input')) {
        return;
    }

    const row = input.closest('tr');
    const ticker = row.dataset.ticker;
    const values = {};
    row.querySelectorAll('.holding-input').forEach((field) => {
        values[field.dataset.field] = field.value.trim() === ''
            ? null
            : nonNegativeNumber(Number(field.value));
    });

    if (values.shares === null && values.cost === null) {
        holdings.delete(ticker);
    } else {
        holdings.set(ticker, { shares: values.shares, cost: values.cost });
    }

    renderHolding(row);
    renderPortfolioSummary();
    scheduleSave(typingSaveDelayMs);
}));

// A change made just before the page is closed is still waiting to be saved;
// send it now. keepalive lets the request finish after the page is gone.
window.addEventListener('pagehide', () => {
    if (saveTimer === null || saveBlocked) {
        return;
    }

    window.clearTimeout(saveTimer);
    saveTimer = null;
    fetch('data.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portfolioState()),
        keepalive: true,
    });
});

// Redraws the graphs at their new size when the window changes width.
new ResizeObserver(() => liveCharts.forEach((chart) => {
    if (chart.drawn && Math.round(chart.plot.clientWidth) !== chart.drawn.width) {
        scheduleLiveChartDraw(chart);
    }
})).observe(liveChartsList);

liveChartsList.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-action="chart"]') : null;
    if (button) {
        openLargeChart(button.closest('.live-chart-card').dataset.ticker);
    }
});

rangeButtons.forEach((button) => button.addEventListener('click', () => loadLargeChart(button.dataset.range)));
chartDialog.addEventListener('close', () => {
    // Ignore a chart still loading for the stock that was just closed.
    largeChartRequest += 1;
    largeChartTicker = null;
    chartDialogTooltip.hidden = true;
});

initializeStocks();
if (typeof PriceStream !== 'undefined') {
    priceStream = PriceStream.create({ onPrice: applyStreamPrice, onStateChange: handleStreamStateChange });
    syncStreamTickers();
} else {
    handleStreamStateChange('down');
}
refreshButton.addEventListener('click', refreshQuotes);
window.setInterval(() => {
    if (priceStream?.isLive() && streamIsQuiet()) {
        priceStream.reconnect();
    }
    if (!isRefreshing && Date.now() >= nextRefreshAt) {
        refreshQuotes();
    }
    updateRefreshCountdown();
    renderMarketStatus();
}, 250);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        refreshQuotes();
    } else {
        updateRefreshCountdown();
    }
});
updateRefreshCountdown();
refreshQuotes();
