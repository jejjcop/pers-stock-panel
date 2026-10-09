<?php

declare(strict_types=1);

// Calculations and Yahoo Finance helpers used by public/quotes.php. They are
// kept here, separate from the endpoint, so they can be unit tested.

function periodChangePct(array $timestamps, array $closes, float $price, int $marketTime, int $days): ?float
{
    $targetTime = $marketTime - ($days * 86_400);
    $baselineClose = null;
    $baselineTime = null;

    foreach ($timestamps as $index => $timestamp) {
        $close = $closes[$index] ?? null;
        if (!is_numeric($timestamp) || !is_numeric($close) || (int) $timestamp > $targetTime) {
            continue;
        }

        if ($baselineTime === null || (int) $timestamp > $baselineTime) {
            $baselineTime = (int) $timestamp;
            $baselineClose = (float) $close;
        }
    }

    if ($baselineClose === null || $baselineClose == 0.0) {
        return null;
    }

    return (($price - $baselineClose) / $baselineClose) * 100;
}

function previousTradingClose(
    array $timestamps,
    array $closes,
    int $marketTime,
    string $timezone
): ?float {
    $marketDate = (new DateTimeImmutable('@' . $marketTime))
        ->setTimezone(new DateTimeZone($timezone))
        ->format('Y-m-d');
    $previousClose = null;
    $previousDate = null;

    foreach ($timestamps as $index => $timestamp) {
        $close = $closes[$index] ?? null;
        if (!is_numeric($timestamp) || !is_numeric($close)) {
            continue;
        }

        $barDate = (new DateTimeImmutable('@' . (int) $timestamp))
            ->setTimezone(new DateTimeZone($timezone))
            ->format('Y-m-d');
        if ($barDate >= $marketDate || ($previousDate !== null && $barDate <= $previousDate)) {
            continue;
        }

        $previousDate = $barDate;
        $previousClose = (float) $close;
    }

    return $previousClose;
}

function latestSessionQuote(array $timestamps, array $closes, mixed $period): ?array
{
    $session = is_array($period) ? ($period[0][0] ?? null) : null;
    if (!is_array($session) || !is_numeric($session['start'] ?? null) || !is_numeric($session['end'] ?? null)) {
        return null;
    }

    $latestTimestamp = null;
    $latestPrice = null;
    foreach ($timestamps as $index => $timestamp) {
        $close = $closes[$index] ?? null;
        if (!is_numeric($timestamp) || !is_numeric($close)) {
            continue;
        }

        $timestamp = (int) $timestamp;
        if ($timestamp < (int) $session['start'] || $timestamp >= (int) $session['end']) {
            continue;
        }

        if ($latestTimestamp === null || $timestamp > $latestTimestamp) {
            $latestTimestamp = $timestamp;
            $latestPrice = (float) $close;
        }
    }

    if ($latestTimestamp === null || $latestPrice === null) {
        return null;
    }

    return ['price' => $latestPrice, 'time' => $latestTimestamp];
}

/**
 * Keeps the day's 1-minute closes from the regular session only, thinned to
 * the last close in each 5-minute bucket, which is plenty of detail for a
 * small chart.
 *
 * @return array<int, array{0: int, 1: float}>
 */
function intradayPoints(array $timestamps, array $closes, mixed $regularPeriod): array
{
    $session = sessionBounds(is_array($regularPeriod) ? ($regularPeriod[0][0] ?? null) : null);
    if ($session === null) {
        return [];
    }

    $buckets = [];
    foreach ($timestamps as $index => $timestamp) {
        $close = $closes[$index] ?? null;
        if (!is_numeric($timestamp) || !is_numeric($close)) {
            continue;
        }
        if ((int) $timestamp < $session[0] || (int) $timestamp >= $session[1]) {
            continue;
        }

        $buckets[intdiv((int) $timestamp, 300)] = [(int) $timestamp, round((float) $close, 4)];
    }

    ksort($buckets);

    return array_values($buckets);
}

function activeExtendedSession(array $periods, int $currentTime): ?string
{
    foreach (['pre' => 'preMarket', 'post' => 'afterHours'] as $periodKey => $sessionName) {
        $session = $periods[$periodKey][0][0] ?? null;
        if (!is_array($session) || !is_numeric($session['start'] ?? null) || !is_numeric($session['end'] ?? null)) {
            continue;
        }

        if ($currentTime >= (int) $session['start'] && $currentTime < (int) $session['end']) {
            return $sessionName;
        }
    }

    return null;
}

/**
 * @return array{0: int, 1: int}|null
 */
function sessionBounds(mixed $session): ?array
{
    if (!is_array($session) || !is_numeric($session['start'] ?? null) || !is_numeric($session['end'] ?? null)) {
        return null;
    }

    return [(int) $session['start'], (int) $session['end']];
}

/**
 * Finds the next weekday regular-session open after $now. It does not know
 * about exchange holidays.
 */
function nextRegularOpen(int $sampleOpen, string $timezone, int $now): int
{
    $zone = new DateTimeZone($timezone);
    $openTime = (new DateTimeImmutable('@' . $sampleOpen))->setTimezone($zone)->format('H:i:s');
    $day = (new DateTimeImmutable('@' . $now))->setTimezone($zone);

    for ($i = 0; $i < 8; $i++) {
        $candidate = new DateTimeImmutable($day->format('Y-m-d') . ' ' . $openTime, $zone);
        if ((int) $candidate->format('N') <= 5 && $candidate->getTimestamp() > $now) {
            return $candidate->getTimestamp();
        }
        $day = $day->modify('+1 day');
    }

    return $sampleOpen;
}

function marketStatus(array $periods, string $timezone, string $exchange, int $now): ?array
{
    $pre = sessionBounds($periods['pre'] ?? null);
    $regular = sessionBounds($periods['regular'] ?? null);
    $post = sessionBounds($periods['post'] ?? null);
    if ($regular === null) {
        return null;
    }

    $isWithin = static fn (?array $bounds): bool => $bounds !== null && $now >= $bounds[0] && $now < $bounds[1];
    if ($isWithin($regular)) {
        [$session, $nextChangeLabel, $nextChangeAt] = ['open', 'Closes', $regular[1]];
    } elseif ($isWithin($pre)) {
        [$session, $nextChangeLabel, $nextChangeAt] = ['preMarket', 'Opens', $regular[0]];
    } elseif ($isWithin($post)) {
        [$session, $nextChangeLabel, $nextChangeAt] = ['afterHours', 'After-hours ends', $post[1]];
    } else {
        // Yahoo's upcoming session already accounts for holidays, so prefer it.
        $nextOpen = $regular[0] > $now ? $regular[0] : nextRegularOpen($regular[0], $timezone, $now);
        [$session, $nextChangeLabel, $nextChangeAt] = ['closed', 'Opens', $nextOpen];
    }

    // The next moment any session (pre-market, regular or after-hours)
    // starts or ends, so the page can refresh right then.
    $boundaries = [];
    foreach ([$pre, $regular, $post] as $bounds) {
        if ($bounds !== null) {
            array_push($boundaries, ...$bounds);
        }
    }
    $upcoming = array_filter($boundaries, static fn (int $time): bool => $time > $now);
    if ($upcoming !== []) {
        $nextSessionChangeAt = min($upcoming);
    } else {
        $preMarketLength = $pre !== null ? $regular[0] - $pre[0] : 0;
        $nextSessionChangeAt = $nextChangeAt - $preMarketLength;
    }

    return [
        'session' => $session,
        'name' => $timezone === 'America/New_York' ? 'US market' : trim($exchange . ' market'),
        'nextChangeLabel' => $nextChangeLabel,
        'nextChangeAt' => $nextChangeAt,
        'nextSessionChangeAt' => $nextSessionChangeAt,
    ];
}

// Three months of daily closes only change once a day, so they are cached
// briefly on disk instead of being downloaded on every refresh.
const DAILY_CACHE_SECONDS = 300;
// Exchange rates are shown as an approximation, so a minute old is fine.
const FX_CACHE_SECONDS = 60;

/**
 * A cached Yahoo chart response. $kind names the folder, e.g. 'daily', and
 * $key the file within it; both only ever contain letters, digits, dots,
 * hyphens and '=' (from validated tickers), so they are safe as file names.
 */
function chartCachePath(string $kind, string $key): string
{
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'stock-panel-' . $kind . DIRECTORY_SEPARATOR . $key . '.json';
}

function readChartCache(string $kind, string $key, int $maxAgeSeconds): ?array
{
    $path = chartCachePath($kind, $key);
    $modified = @filemtime($path);
    if ($modified === false || time() - $modified >= $maxAgeSeconds) {
        return null;
    }

    $body = @file_get_contents($path);

    return $body === false ? null : chartResult($body);
}

function writeChartCache(string $kind, string $key, string $body): void
{
    $path = chartCachePath($kind, $key);
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
        return;
    }

    // Write to a temporary file first so a parallel request never reads a
    // half-written cache file.
    $temporaryPath = @tempnam($directory, 'chart');
    if ($temporaryPath === false) {
        return;
    }
    if (@file_put_contents($temporaryPath, $body) === false || !@rename($temporaryPath, $path)) {
        @unlink($temporaryPath);
    }
}

/**
 * Returns the chart result from a Yahoo chart response, or null when the
 * response is not usable.
 */
function chartResult(string $body): ?array
{
    try {
        $data = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }

    $result = is_array($data) ? ($data['chart']['result'][0] ?? null) : null;

    return is_array($result) && is_array($result['meta'] ?? null) ? $result : null;
}

/**
 * @return array{0: array, 1: array} The timestamps and closes of a chart result.
 */
function chartSeries(array $result): array
{
    $timestamps = is_array($result['timestamp'] ?? null) ? $result['timestamp'] : [];
    $quoteIndicators = $result['indicators']['quote'][0] ?? null;
    $closes = is_array($quoteIndicators) && is_array($quoteIndicators['close'] ?? null)
        ? $quoteIndicators['close']
        : [];

    return [$timestamps, $closes];
}

/**
 * A request for Yahoo's chart data for one symbol, set up the way Yahoo
 * accepts it. $query is e.g. 'range=1d&interval=1m'.
 */
function yahooChartRequest(string $symbol, string $query): CurlHandle
{
    $handle = curl_init('https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode($symbol) . '?' . $query);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_ENCODING => '',
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Referer: https://finance.yahoo.com/',
        ],
    ];
    if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
        $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
    }
    curl_setopt_array($handle, $options);

    return $handle;
}

/**
 * Runs requests in parallel and returns each one's finishRequest() result,
 * keyed like $handles.
 *
 * @param array<string, CurlHandle> $handles
 * @return array<string, array{result: ?array, body: ?string, error: ?string}>
 */
function runRequests(array $handles, bool &$rateLimited): array
{
    if ($handles === []) {
        return [];
    }

    $multiHandle = curl_multi_init();
    foreach ($handles as $handle) {
        curl_multi_add_handle($multiHandle, $handle);
    }

    do {
        $multiStatus = curl_multi_exec($multiHandle, $running);
        if ($running && $multiStatus === CURLM_OK && curl_multi_select($multiHandle, 1.0) === -1) {
            usleep(10_000);
        }
    } while ($running && $multiStatus === CURLM_OK);

    $responses = [];
    foreach ($handles as $key => $handle) {
        $responses[$key] = finishRequest($handle, $multiHandle, $multiStatus, $rateLimited);
    }
    curl_multi_close($multiHandle);

    return $responses;
}

/**
 * The currencies that need an exchange rate to Swedish kronor: every
 * three-letter currency code among the quotes except SEK itself. Codes like
 * Yahoo's 'GBp' (pence) are left out.
 *
 * @return list<string>
 */
function currenciesToConvert(array $quotes): array
{
    $currencies = [];
    foreach ($quotes as $quote) {
        $currency = $quote['currency'] ?? null;
        if (is_string($currency) && preg_match('/^[A-Z]{3}$/', $currency) === 1 && $currency !== 'SEK') {
            $currencies[$currency] = true;
        }
    }

    return array_keys($currencies);
}

/**
 * Yahoo's symbol for the rate from a currency to kronor, e.g. 'USDSEK=X'.
 */
function fxSymbol(string $currency): string
{
    return $currency . 'SEK=X';
}

function fxRate(array $chartResult): ?float
{
    $rate = $chartResult['meta']['regularMarketPrice'] ?? null;

    return is_numeric($rate) && (float) $rate > 0 ? (float) $rate : null;
}

/**
 * The periods the large chart offers, with the Yahoo range and bar size for
 * each, and how long a downloaded chart may be reused.
 */
const HISTORY_RANGES = [
    '1d' => ['range' => '1d', 'interval' => '5m', 'cacheSeconds' => 60],
    '1w' => ['range' => '5d', 'interval' => '30m', 'cacheSeconds' => 300],
    '1m' => ['range' => '1mo', 'interval' => '60m', 'cacheSeconds' => 900],
    '1y' => ['range' => '1y', 'interval' => '1d', 'cacheSeconds' => 3600],
    '5y' => ['range' => '5y', 'interval' => '1wk', 'cacheSeconds' => 3600],
];

/**
 * The points of a chart result as [timestamp, close] pairs, without bars
 * that have no close.
 *
 * @return list<array{0: int, 1: float}>
 */
function historyPoints(array $chartResult): array
{
    [$timestamps, $closes] = chartSeries($chartResult);
    $points = [];
    foreach ($timestamps as $index => $timestamp) {
        $close = $closes[$index] ?? null;
        if (is_numeric($timestamp) && is_numeric($close)) {
            $points[] = [(int) $timestamp, round((float) $close, 4)];
        }
    }

    return $points;
}

/**
 * Collects one finished request from the multi handle.
 *
 * @return array{result: ?array, body: ?string, error: ?string}
 */
function finishRequest(CurlHandle $handle, CurlMultiHandle $multiHandle, int $multiStatus, bool &$rateLimited): array
{
    $body = (string) curl_multi_getcontent($handle);
    $httpStatus = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $networkError = curl_error($handle);
    curl_multi_remove_handle($multiHandle, $handle);

    $failure = static fn (string $error): array => ['result' => null, 'body' => null, 'error' => $error];
    if ($multiStatus !== CURLM_OK) {
        return $failure('The quote request did not complete.');
    }
    if ($networkError !== '') {
        return $failure('Network error while contacting Yahoo Finance.');
    }
    if ($httpStatus === 429) {
        $rateLimited = true;
        return $failure('Yahoo Finance is temporarily rate-limiting requests.');
    }
    if ($httpStatus !== 200) {
        return $failure("Yahoo Finance returned HTTP {$httpStatus}.");
    }

    $result = chartResult($body);

    return $result === null
        ? $failure('Yahoo Finance returned an unexpected response.')
        : ['result' => $result, 'body' => $body, 'error' => null];
}
