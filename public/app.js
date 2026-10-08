const addStockForm = document.getElementById('add-stock-form');
const tickerInput = document.getElementById('new-ticker');
const listSelect = document.getElementById('new-list');
const stockBodies = Array.from(document.querySelectorAll('tbody[data-list]'));
const status = document.getElementById('watchlist-status');
const refreshButton = document.getElementById('refresh-quotes');
const refreshCountdown = document.getElementById('refresh-countdown');
const storageKey = 'stock-panel-added-tickers';
const holdingsKey = 'stock-panel-holdings';
const holdings = new Map();
const portfolioSummary = document.getElementById('portfolio-summary');
const portfolioCost = document.getElementById('portfolio-cost');
const portfolioValue = document.getElementById('portfolio-value');
const portfolioGain = document.getElementById('portfolio-gain');
const portfolioDay = document.getElementById('portfolio-day');
const allocationPanel = document.getElementById('allocation-panel');
const allocationList = document.getElementById('allocation-list');
const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;
const listNames = {
    owned: 'My current stocks',
    monitor: 'Stocks to monitor',
};
const maxStocks = 25;
const svgNamespace = 'http://www.w3.org/2000/svg';
const sparklineWidth = 140;
const sparklineHeight = 40;
const sparklineInset = 3;
const chartState = new WeakMap();
const chartTooltip = document.createElement('div');
chartTooltip.className = 'chart-tooltip';
chartTooltip.hidden = true;
document.body.append(chartTooltip);
const builtInTickers = new Set(allRows().map((row) => row.dataset.ticker));
const addedTickers = new Map();
const removedTickers = new Set();
const marketOpenRefreshMs = 5_000;
const extendedHoursRefreshMs = 15_000;
const marketClosedRefreshMs = 120_000;
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
}

function saveStocks() {
    localStorage.setItem(storageKey, JSON.stringify({
        added: Array.from(addedTickers, ([ticker, list]) => ({ ticker, list })),
        removed: Array.from(removedTickers),
    }));
}

function nonNegativeNumber(value) {
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function loadHoldings() {
    try {
        const saved = JSON.parse(localStorage.getItem(holdingsKey) || '{}');
        Object.entries(saved).forEach(([ticker, holding]) => {
            if (tickerPattern.test(ticker) && holding && typeof holding === 'object') {
                holdings.set(ticker, {
                    shares: nonNegativeNumber(holding.shares),
                    cost: nonNegativeNumber(holding.cost),
                });
            }
        });
    } catch (error) {
        showStatus('Could not load your saved shares and costs from this browser.', true);
    }
}

function saveHoldings() {
    localStorage.setItem(holdingsKey, JSON.stringify(Object.fromEntries(holdings)));
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

function addHoldingCells(row) {
    if (row.querySelector('.holding-cell')) {
        return;
    }

    const ticker = row.dataset.ticker;
    const holding = holdings.get(ticker) || {};
    row.querySelector('.quote-name').after(
        createHoldingInputCell('shares', holding.shares, `Shares of ${ticker} you own`),
        createHoldingInputCell('cost', holding.cost, `Average price you paid per ${ticker} share`)
    );
    const costTotalCell = document.createElement('td');
    costTotalCell.className = 'holding-cell holding-cost-total';
    costTotalCell.textContent = '—';
    row.querySelectorAll('.holding-cell')[1].after(costTotalCell);

    const valueCell = document.createElement('td');
    valueCell.className = 'holding-cell holding-value';
    valueCell.textContent = '—';
    const gainCell = document.createElement('td');
    gainCell.className = 'holding-cell holding-gain';
    gainCell.textContent = '—';
    row.querySelector('.quote-price').after(valueCell, gainCell);
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
    renderAllocation(positions);
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
    refreshIntervalMs = Math.min(baseRefreshMs * 2 ** backoffLevel, maxRefreshMs);
}

function describeRefreshInterval() {
    const seconds = Math.round(refreshIntervalMs / 1000);
    if (seconds >= 60 && seconds % 60 === 0) {
        const minutes = seconds / 60;
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${seconds} seconds`;
}

function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
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

function addRemoveButton(row) {
    let actionCell = row.querySelector('.action-cell');
    if (!actionCell) {
        actionCell = document.createElement('td');
        actionCell.className = 'action-cell';
        row.append(actionCell);
    }
    if (actionCell.querySelector('button')) {
        return;
    }

    const button = document.createElement('button');
    button.className = 'remove-stock-button';
    button.type = 'button';
    button.dataset.action = 'remove';
    button.textContent = 'Remove';
    button.setAttribute('aria-label', `Remove ${row.dataset.ticker}`);

    actionCell.append(button);
}

function addTickerRow(ticker, list) {
    const row = document.createElement('tr');
    row.dataset.ticker = ticker;
    row.classList.add('user-added-stock');

    [
        [ticker, ''],
        ['—', 'quote-name'],
        ['—', 'quote-price'],
        ['—', 'quote-change'],
        ['—', 'quote-chart'],
        ['—', 'quote-week'],
        ['—', 'quote-month'],
        ['—', 'quote-volume'],
    ].forEach(([value, className]) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.className = className;
        row.append(cell);
    });

    const extendedHoursCell = document.createElement('td');
    extendedHoursCell.className = 'extended-hours-cell';
    const extendedHoursValue = document.createElement('span');
    extendedHoursValue.className = 'extended-hours-value';
    extendedHoursValue.textContent = '—';
    extendedHoursCell.append(extendedHoursValue);
    row.append(extendedHoursCell);

    addHoldingCells(row);
    addRemoveButton(row);
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
    row.dataset.currency = quote.currency || 'USD';
    row.dataset.regularPrice = Number.isFinite(quote.price) ? String(quote.price) : '';
    row.dataset.previousClose = Number.isFinite(quote.previousClose) ? String(quote.previousClose) : '';
    row.dataset.changePct = Number.isFinite(quote.changePct) ? String(quote.changePct) : '';
    priceCell.textContent = Number.isFinite(quote.price)
        ? formatPrice(quote.price, quote.currency)
        : '—';

    renderPercentChange(changeCell, quote.changePct);
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

    if (!quote || !Number.isFinite(quote.price)) {
        element.textContent = '—';
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

    cell.replaceChildren(svg);
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

        baseRefreshMs = result.marketOpen
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
        const refreshNote = `${sessionNote}: refreshing every ${describeRefreshInterval()}.`;

        const market = result.market;
        marketState = market && Object.hasOwn(sessionLabels, market.session) && Number.isFinite(market.nextChangeAt)
            ? market
            : null;
        renderMarketStatus();

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
            }
        });

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
            showStatus(`Prices updated at ${updatedAt} from Yahoo Finance. ${refreshNote}`);
        }
    } catch (error) {
        applyBackoff(true);
        showStatus(`Could not refresh prices: ${error.message} Trying again in ${describeRefreshInterval()}.`, true);
    } finally {
        isRefreshing = false;
        refreshButton.disabled = false;
        refreshButton.textContent = 'Refresh prices';
        nextRefreshAt = Date.now() + refreshIntervalMs;
        // Refresh right as the next session starts or ends, so a long
        // closed-market wait never delays the first pre-market prices.
        const nextChangeMs = marketState && Number.isFinite(marketState.nextSessionChangeAt)
            ? marketState.nextSessionChangeAt * 1000 + 1000
            : NaN;
        if (nextChangeMs > Date.now()) {
            nextRefreshAt = Math.min(nextRefreshAt, nextChangeMs);
        }
        updateRefreshCountdown();
        if (refreshQueued) {
            refreshQueued = false;
            refreshQuotes();
        }
    }
}

function loadAddedTickers() {
    try {
        const saved = localStorage.getItem(storageKey);
        if (!saved) {
            return;
        }

        const savedWatchlist = JSON.parse(saved);
        const savedAddedTickers = Array.isArray(savedWatchlist)
            ? savedWatchlist
            : savedWatchlist.added;
        const savedRemovedTickers = Array.isArray(savedWatchlist)
            ? []
            : savedWatchlist.removed;
        if (!Array.isArray(savedAddedTickers) || !Array.isArray(savedRemovedTickers)) {
            throw new Error('Saved watchlist data is invalid.');
        }

        savedRemovedTickers.forEach((value) => {
            if (typeof value === 'string' && tickerPattern.test(value)) {
                removedTickers.add(value);
            }
        });

        allRows().forEach((row) => {
            if (removedTickers.has(row.dataset.ticker)) {
                row.remove();
            }
        });

        savedAddedTickers.forEach((value) => {
            // Older saves stored plain ticker strings; those stocks were in the
            // section that is now "My current stocks".
            const entry = typeof value === 'string' ? { ticker: value, list: 'owned' } : value;
            if (!entry || typeof entry.ticker !== 'string') {
                return;
            }

            const ticker = entry.ticker.trim().toUpperCase();
            const list = Object.hasOwn(listNames, entry.list) ? entry.list : 'owned';
            if (!tickerPattern.test(ticker) || addedTickers.has(ticker)) {
                return;
            }

            addedTickers.set(ticker, list);
            // A saved entry for a built-in stock records which section the
            // user put it in, so move the server-rendered row there.
            const builtInRow = findRow(ticker);
            if (builtInRow) {
                bodyFor(list).append(builtInRow);
            } else {
                addTickerRow(ticker, list);
            }
        });
    } catch (error) {
        showStatus('Could not load saved stocks from this browser. You can still add stocks for this visit.', true);
    } finally {
        allRows().forEach((row) => {
            addHoldingCells(row);
            addRemoveButton(row);
        });
        updateEmptyStates();
    }
}

stockBodies.forEach((body) => body.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
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
    addedTickers.delete(ticker);
    if (builtInTickers.has(ticker)) {
        removedTickers.add(ticker);
    }

    holdings.delete(ticker);
    row.remove();
    updateEmptyStates();
    renderPortfolioSummary();

    try {
        saveStocks();
        saveHoldings();
        showStatus(`${ticker} removed from ${listName}.`);
    } catch (error) {
        showStatus(`${ticker} was removed for this visit, but the change could not be saved in this browser.`, true);
    }
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

        const previousList = addedTickers.get(ticker);
        try {
            addedTickers.set(ticker, list);
            saveStocks();
        } catch (error) {
            if (previousList) {
                addedTickers.set(ticker, previousList);
            } else {
                addedTickers.delete(ticker);
            }
            showStatus(`Could not save the change for ${ticker} in this browser, so it was not moved.`, true);
            return;
        }
        bodyFor(list).append(existingRow);
        sortRowsByDayChange();
        updateEmptyStates();
        renderPortfolioSummary();
        tickerInput.value = '';
        showStatus(`${ticker} moved from ${listNames[existingList]} to ${listNames[list]}.`);
        return;
    }
    if (allRows().length >= maxStocks) {
        showStatus(`You can track up to ${maxStocks} stocks in total.`, true);
        return;
    }

    const wasRemoved = removedTickers.has(ticker);
    try {
        addedTickers.set(ticker, list);
        removedTickers.delete(ticker);
        saveStocks();
    } catch (error) {
        addedTickers.delete(ticker);
        if (wasRemoved) {
            removedTickers.add(ticker);
        }
        showStatus(`Could not save ${ticker} in this browser, so it was not added.`, true);
        return;
    }
    addTickerRow(ticker, list);
    updateEmptyStates();
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

    try {
        saveHoldings();
    } catch (error) {
        showStatus(`Could not save the shares and cost for ${ticker} in this browser.`, true);
    }
}));

loadHoldings();
loadAddedTickers();
refreshButton.addEventListener('click', refreshQuotes);
window.setInterval(() => {
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
