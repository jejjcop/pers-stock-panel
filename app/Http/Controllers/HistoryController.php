<?php

namespace App\Http\Controllers;

use App\Services\YahooFinance;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Price history for one stock over one period, for the large chart
 * (/history?symbol=MU&range=1y).
 */
class HistoryController extends Controller
{
    public function __invoke(Request $request, YahooFinance $yahoo): JsonResponse
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
        $chart = $yahoo->charts(['chart' => [
            'symbol' => $symbol,
            'query' => ['range' => $settings['range'], 'interval' => $settings['interval']],
            'cacheSeconds' => $settings['cacheSeconds'],
        ]])['chart'];
        if ($chart->result === null) {
            return $this->respond($yahoo->wasRateLimited() ? 429 : 502, ['error' => $chart->error]);
        }

        $meta = $chart->result['meta'];
        $previousClose = $meta['chartPreviousClose'] ?? $meta['previousClose'] ?? null;

        return $this->respond(200, [
            'symbol' => $symbol,
            'range' => $range,
            'currency' => is_string($meta['currency'] ?? null) ? $meta['currency'] : 'USD',
            // Only the one-day chart compares with the previous close; longer
            // periods compare with their first point.
            'previousClose' => $range === '1d' && is_numeric($previousClose) ? (float) $previousClose : null,
            'points' => historyPoints($chart->result),
        ]);
    }

    private function respond(int $status, array $payload): JsonResponse
    {
        return response()->json($payload, $status, ['Cache-Control' => 'no-store'], JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
