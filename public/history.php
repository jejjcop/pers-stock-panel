<?php

declare(strict_types=1);

// Price history for one stock over one period, for the large chart.

ini_set('display_errors', '0');
ini_set('log_errors', '1');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/../src/quote_functions.php';
require_once __DIR__ . '/../src/portfolio.php';

function respondJson(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    respondJson(405, ['error' => 'Only GET requests are supported.']);
}

$symbol = strtoupper(trim((string) ($_GET['symbol'] ?? '')));
$range = (string) ($_GET['range'] ?? '');
if (preg_match(TICKER_PATTERN, $symbol) !== 1) {
    respondJson(400, ['error' => 'The stock symbol has an invalid format.']);
}
if (!isset(HISTORY_RANGES[$range])) {
    respondJson(400, ['error' => 'Choose one of the periods ' . implode(', ', array_keys(HISTORY_RANGES)) . '.']);
}

$settings = HISTORY_RANGES[$range];
$cacheKey = "{$symbol}-{$range}";
$result = readChartCache('history', $cacheKey, $settings['cacheSeconds']);
if ($result === null) {
    $rateLimited = false;
    $request = yahooChartRequest($symbol, "range={$settings['range']}&interval={$settings['interval']}");
    $response = runRequests(['chart' => $request], $rateLimited)['chart'];
    if ($response['result'] === null) {
        respondJson($rateLimited ? 429 : 502, ['error' => $response['error']]);
    }
    $result = $response['result'];
    writeChartCache('history', $cacheKey, $response['body']);
}

$meta = $result['meta'];
$previousClose = $meta['chartPreviousClose'] ?? $meta['previousClose'] ?? null;

respondJson(200, [
    'symbol' => $symbol,
    'range' => $range,
    'currency' => is_string($meta['currency'] ?? null) ? $meta['currency'] : 'USD',
    // Only the one-day chart compares with the previous close; longer
    // periods compare with their first point.
    'previousClose' => $range === '1d' && is_numeric($previousClose) ? (float) $previousClose : null,
    'points' => historyPoints($result),
]);
