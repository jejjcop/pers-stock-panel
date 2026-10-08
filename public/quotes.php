<?php

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

set_exception_handler(static function (Throwable $error): void {
    error_log('Stock Panel quote endpoint: ' . $error);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    }
    echo '{"error":"The quote service failed. Check the PHP server error log for details."}';
});

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

require_once __DIR__ . '/../src/quote_functions.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    respond(405, ['error' => 'Only GET requests are supported.']);
}

if (!function_exists('curl_init') || !function_exists('curl_multi_init')) {
    respond(503, ['error' => 'PHP cURL with multi-request support is required to fetch live quotes.']);
}

$rawSymbols = (string) ($_GET['symbols'] ?? '');
$symbols = array_values(array_unique(array_filter(
    array_map('strtoupper', array_map('trim', explode(',', $rawSymbols))),
    static fn (string $symbol): bool => $symbol !== ''
)));

if ($symbols === [] || count($symbols) > 25) {
    respond(400, ['error' => 'Provide between 1 and 25 stock symbols.']);
}

foreach ($symbols as $symbol) {
    if (preg_match('/^[A-Z0-9][A-Z0-9.-]{0,9}$/', $symbol) !== 1) {
        respond(400, ['error' => 'One or more stock symbols have an invalid format.']);
    }
}

$dailyHandles = [];
$minuteHandles = [];
$dailyResults = [];
$multiHandle = curl_multi_init();
$userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

foreach ($symbols as $symbol) {
    $baseUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode($symbol);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_ENCODING => '',
        CURLOPT_USERAGENT => $userAgent,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Referer: https://finance.yahoo.com/',
        ],
    ];

    if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
        $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
    }

    $cachedDaily = readDailyCache($symbol);
    if ($cachedDaily !== null) {
        $dailyResults[$symbol] = $cachedDaily;
    } else {
        $dailyHandle = curl_init($baseUrl . '?range=3mo&interval=1d');
        curl_setopt_array($dailyHandle, $options);
        curl_multi_add_handle($multiHandle, $dailyHandle);
        $dailyHandles[$symbol] = $dailyHandle;
    }

    $minuteHandle = curl_init($baseUrl . '?range=1d&interval=1m&includePrePost=true');
    curl_setopt_array($minuteHandle, $options);
    curl_multi_add_handle($multiHandle, $minuteHandle);
    $minuteHandles[$symbol] = $minuteHandle;
}

do {
    $multiStatus = curl_multi_exec($multiHandle, $running);
    if ($running && $multiStatus === CURLM_OK) {
        $selected = curl_multi_select($multiHandle, 1.0);
        if ($selected === -1) {
            usleep(10_000);
        }
    }
} while ($running && $multiStatus === CURLM_OK);

$quotes = [];
$errors = [];
$extendedErrors = [];
$extendedQuotes = [];
$marketOpen = false;
$tradingActive = false;
$marketReference = null;
$rateLimited = false;
$now = time();

$freshDaily = [];
foreach ($dailyHandles as $symbol => $handle) {
    $response = finishRequest($handle, $multiHandle, $multiStatus, $rateLimited);
    if ($response['result'] !== null) {
        $dailyResults[$symbol] = $response['result'];
        $freshDaily[$symbol] = true;
        writeDailyCache($symbol, $response['body']);
    }
}

$minuteResults = [];
$minuteErrors = [];
foreach ($minuteHandles as $symbol => $handle) {
    $response = finishRequest($handle, $multiHandle, $multiStatus, $rateLimited);
    if ($response['result'] !== null) {
        $minuteResults[$symbol] = $response['result'];
    } else {
        $minuteErrors[$symbol] = $response['error'];
    }
}

curl_multi_close($multiHandle);

foreach ($symbols as $symbol) {
    $minute = $minuteResults[$symbol] ?? null;
    $daily = $dailyResults[$symbol] ?? null;

    // Live fields come from the 1-minute data. If that request failed, daily
    // data downloaded in this same refresh is just as current; a cached copy
    // is not.
    $meta = $minute['meta'] ?? (isset($freshDaily[$symbol]) ? $daily['meta'] : null);
    $price = is_array($meta) ? ($meta['regularMarketPrice'] ?? null) : null;
    if (!is_numeric($price)) {
        $errors[$symbol] = $minuteErrors[$symbol] ?? 'No current quote was available for this symbol.';
        continue;
    }

    // Daily history drives the previous close and week/month changes. Without
    // it, fall back to Yahoo's own previous close and leave week/month blank.
    [$timestamps, $closes] = $daily !== null ? chartSeries($daily) : [[], []];

    $price = (float) $price;
    $marketTime = is_numeric($meta['regularMarketTime'] ?? null)
        ? (int) $meta['regularMarketTime']
        : time();
    $timezone = is_string($meta['exchangeTimezoneName'] ?? null)
        ? $meta['exchangeTimezoneName']
        : 'UTC';
    $previousClose = previousTradingClose($timestamps, $closes, $marketTime, $timezone);
    if ($previousClose === null && is_numeric($meta['previousClose'] ?? null)) {
        $previousClose = (float) $meta['previousClose'];
    }
    $changePct = $previousClose !== null && $previousClose != 0.0
        ? (($price - $previousClose) / $previousClose) * 100
        : null;
    $volume = $meta['regularMarketVolume'] ?? null;

    $regularSession = $meta['currentTradingPeriod']['regular'] ?? null;
    if (
        is_array($regularSession)
        && is_numeric($regularSession['start'] ?? null)
        && is_numeric($regularSession['end'] ?? null)
        && $now >= (int) $regularSession['start']
        && $now < (int) $regularSession['end']
    ) {
        $marketOpen = true;
    }

    // The status badge follows one exchange: New York when any stock trades
    // there, otherwise the first stock's exchange.
    $tradingPeriod = $meta['currentTradingPeriod'] ?? null;
    if (is_array($tradingPeriod)) {
        foreach (['pre', 'regular', 'post'] as $periodKey) {
            $bounds = sessionBounds($tradingPeriod[$periodKey] ?? null);
            if ($bounds !== null && $now >= $bounds[0] && $now < $bounds[1]) {
                $tradingActive = true;
            }
        }
    }

    if (
        is_array($tradingPeriod)
        && (
            $marketReference === null
            || ($timezone === 'America/New_York' && $marketReference['timezone'] !== 'America/New_York')
        )
    ) {
        $marketReference = [
            'periods' => $tradingPeriod,
            'timezone' => $timezone,
            'exchange' => (string) ($meta['fullExchangeName'] ?? $meta['exchangeName'] ?? ''),
        ];
    }

    $quotes[$symbol] = [
        'name' => (string) ($meta['longName'] ?? $meta['shortName'] ?? $symbol),
        'price' => $price,
        'changePct' => $changePct,
        'weekChangePct' => periodChangePct($timestamps, $closes, $price, $marketTime, 7),
        'monthChangePct' => periodChangePct($timestamps, $closes, $price, $marketTime, 30),
        'volume' => is_numeric($volume) ? (float) $volume : null,
        'currency' => (string) ($meta['currency'] ?? 'USD'),
        'previousClose' => $previousClose,
        'marketTime' => $marketTime,
    ];

    if ($minute === null) {
        $extendedErrors[$symbol] = $minuteErrors[$symbol] ?? 'No extended-hours chart was available for this symbol.';
        continue;
    }

    [$minuteTimestamps, $minuteCloses] = chartSeries($minute);
    $periods = $minute['meta']['tradingPeriods'] ?? [];

    // After the close, end the chart on the official closing price so it
    // matches the Price column rather than the last 1-minute trade.
    $intraday = intradayPoints($minuteTimestamps, $minuteCloses, $periods['regular'] ?? null);
    $regularBounds = sessionBounds(is_array($periods['regular'] ?? null) ? ($periods['regular'][0][0] ?? null) : null);
    if ($intraday !== [] && $regularBounds !== null && $now >= $regularBounds[1]) {
        $intraday[] = [$regularBounds[1], round($price, 4)];
    }

    $extendedQuotes[$symbol] = [
        'preMarket' => latestSessionQuote($minuteTimestamps, $minuteCloses, $periods['pre'] ?? null),
        'afterHours' => latestSessionQuote($minuteTimestamps, $minuteCloses, $periods['post'] ?? null),
        'activeSession' => activeExtendedSession($periods, $now),
        'intraday' => $intraday,
    ];
}

respond(200, [
    'quotes' => $quotes,
    'errors' => $errors,
    'extendedQuotes' => $extendedQuotes,
    'extendedErrors' => $extendedErrors,
    'marketOpen' => $marketOpen,
    'tradingActive' => $tradingActive,
    'market' => $marketReference === null
        ? null
        : marketStatus($marketReference['periods'], $marketReference['timezone'], $marketReference['exchange'], $now),
    'rateLimited' => $rateLimited,
    'fetchedAt' => gmdate(DATE_ATOM),
]);
