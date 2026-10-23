<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Price history for one stock over one period, for the large chart.
 *
 * The Yahoo Finance code is still the old one in src/quote_functions.php;
 * step 4 moves it to Laravel's HTTP client and cache.
 */
class HistoryController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $symbol = strtoupper(trim((string) $request->query('symbol', '')));
        $range = (string) $request->query('range', '');
        if (preg_match(TICKER_PATTERN, $symbol) !== 1) {
            return $this->respond(400, ['error' => 'The stock symbol has an invalid format.']);
        }
        if (!isset(HISTORY_RANGES[$range])) {
            return $this->respond(400, ['error' => 'Choose one of the periods ' . implode(', ', array_keys(HISTORY_RANGES)) . '.']);
        }

        $settings = HISTORY_RANGES[$range];
        $cacheKey = "{$symbol}-{$range}";
        $result = readChartCache('history', $cacheKey, $settings['cacheSeconds']);
        if ($result === null) {
            $rateLimited = false;
            $request = yahooChartRequest($symbol, "range={$settings['range']}&interval={$settings['interval']}");
            $response = runRequests(['chart' => $request], $rateLimited)['chart'];
            if ($response['result'] === null) {
                return $this->respond($rateLimited ? 429 : 502, ['error' => $response['error']]);
            }
            $result = $response['result'];
            writeChartCache('history', $cacheKey, $response['body']);
        }

        $meta = $result['meta'];
        $previousClose = $meta['chartPreviousClose'] ?? $meta['previousClose'] ?? null;

        return $this->respond(200, [
            'symbol' => $symbol,
            'range' => $range,
            'currency' => is_string($meta['currency'] ?? null) ? $meta['currency'] : 'USD',
            // Only the one-day chart compares with the previous close; longer
            // periods compare with their first point.
            'previousClose' => $range === '1d' && is_numeric($previousClose) ? (float) $previousClose : null,
            'points' => historyPoints($result),
        ]);
    }

    private function respond(int $status, array $payload): JsonResponse
    {
        return response()->json($payload, $status, ['Cache-Control' => 'no-store'], JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
