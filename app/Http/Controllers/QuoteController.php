<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Prices for the stocks on the page: quotes, extended hours, today's chart
 * points, exchange rates and the market status.
 *
 * The Yahoo Finance code is still the old one in src/quote_functions.php;
 * step 4 moves it to Laravel's HTTP client and cache, in a class of its own.
 */
class QuoteController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        if (!function_exists('curl_init') || !function_exists('curl_multi_init')) {
            return $this->respond(503, ['error' => 'PHP cURL with multi-request support is required to fetch live quotes.']);
        }

        $symbols = array_values(array_unique(array_filter(
            array_map('strtoupper', array_map('trim', explode(',', (string) $request->query('symbols', '')))),
            static fn (string $symbol): bool => $symbol !== ''
        )));

        if ($symbols === [] || count($symbols) > 25) {
            return $this->respond(400, ['error' => 'Provide between 1 and 25 stock symbols.']);
        }

        foreach ($symbols as $symbol) {
            if (preg_match(TICKER_PATTERN, $symbol) !== 1) {
                return $this->respond(400, ['error' => 'One or more stock symbols have an invalid format.']);
            }
        }

        $dailyResults = [];
        $requests = [];
        foreach ($symbols as $symbol) {
            $cachedDaily = readChartCache('daily', $symbol, DAILY_CACHE_SECONDS);
            if ($cachedDaily !== null) {
                $dailyResults[$symbol] = $cachedDaily;
            } else {
                $requests["daily:{$symbol}"] = yahooChartRequest($symbol, 'range=3mo&interval=1d');
            }
            $requests["minute:{$symbol}"] = yahooChartRequest($symbol, 'range=1d&interval=1m&includePrePost=true');
        }

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
        $minuteResults = [];
        $minuteErrors = [];
        foreach (runRequests($requests, $rateLimited) as $key => $response) {
            [$kind, $symbol] = explode(':', $key, 2);
            if ($kind === 'daily') {
                if ($response['result'] !== null) {
                    $dailyResults[$symbol] = $response['result'];
                    $freshDaily[$symbol] = true;
                    writeChartCache('daily', $symbol, $response['body']);
                }
            } elseif ($response['result'] !== null) {
                $minuteResults[$symbol] = $response['result'];
            } else {
                $minuteErrors[$symbol] = $response['error'];
            }
        }

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
                // [start, end] of the regular session the intraday points belong to,
                // so a chart can span the whole trading day.
                'regularSession' => $regularBounds,
            ];
        }

        // Exchange rates to kronor for the currencies the stocks are priced in, so
        // the page can show the portfolio's value in SEK.
        $fxRates = [];
        $fxRequests = [];
        foreach (currenciesToConvert($quotes) as $currency) {
            $cachedRate = readChartCache('fx', fxSymbol($currency), FX_CACHE_SECONDS);
            $rate = $cachedRate !== null ? fxRate($cachedRate) : null;
            if ($rate !== null) {
                $fxRates[$currency] = $rate;
            } else {
                $fxRequests[$currency] = yahooChartRequest(fxSymbol($currency), 'range=1d&interval=1d');
            }
        }
        foreach (runRequests($fxRequests, $rateLimited) as $currency => $response) {
            $rate = $response['result'] !== null ? fxRate($response['result']) : null;
            if ($rate !== null) {
                $fxRates[$currency] = $rate;
                writeChartCache('fx', fxSymbol($currency), $response['body']);
            }
        }

        return $this->respond(200, [
            'quotes' => $quotes,
            'fxRates' => (object) $fxRates,
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
    }

    private function respond(int $status, array $payload): JsonResponse
    {
        return response()->json($payload, $status, ['Cache-Control' => 'no-store'], JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
