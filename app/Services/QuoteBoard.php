<?php

namespace App\Services;

/**
 * Everything the page shows about its stocks' prices, built from Yahoo
 * Finance's charts: the quotes with day, week and month changes, pre-market
 * and after-hours prices, today's chart points, exchange rates to kronor and
 * the market status. The calculations are the functions in
 * src/quote_functions.php.
 */
class QuoteBoard
{
    // Three months of daily closes only change once a day, so they are
    // reused for a few minutes instead of being downloaded on every refresh.
    private const DAILY_CACHE_SECONDS = 300;
    // Exchange rates are shown as an approximation, so a minute old is fine.
    private const FX_CACHE_SECONDS = 60;

    // Laravel creates the YahooFinance service and hands it over (dependency
    // injection), so tests can answer in Yahoo's place with Http::fake().
    public function __construct(private YahooFinance $yahoo)
    {
    }

    /**
     * @param list<string> $symbols checked tickers, e.g. ['MU', 'NVDA']
     * @return array<string, mixed> the answer to /quotes
     */
    public function build(array $symbols, int $now): array
    {
        $requests = [];
        foreach ($symbols as $symbol) {
            $requests["daily:{$symbol}"] = ['symbol' => $symbol, 'query' => ['range' => '3mo', 'interval' => '1d'], 'cacheSeconds' => self::DAILY_CACHE_SECONDS];
            $requests["minute:{$symbol}"] = ['symbol' => $symbol, 'query' => ['range' => '1d', 'interval' => '1m', 'includePrePost' => 'true']];
        }
        $charts = $this->yahoo->charts($requests);

        $quotes = [];
        $errors = [];
        $extendedErrors = [];
        $extendedQuotes = [];
        $marketOpen = false;
        $tradingActive = false;
        $marketReference = null;

        foreach ($symbols as $symbol) {
            $minuteResponse = $charts["minute:{$symbol}"];
            $dailyResponse = $charts["daily:{$symbol}"];
            $minute = $minuteResponse->result;
            $daily = $dailyResponse->result;

            // Live fields come from the 1-minute data. If that request failed, daily
            // data downloaded in this same refresh is just as current; a cached copy
            // is not.
            $meta = $minute['meta'] ?? ($daily !== null && !$dailyResponse->fromCache ? $daily['meta'] : null);
            $price = is_array($meta) ? ($meta['regularMarketPrice'] ?? null) : null;
            if (!is_numeric($price)) {
                $errors[$symbol] = $minuteResponse->error ?? 'No current quote was available for this symbol.';
                continue;
            }

            // Daily history drives the previous close and week/month changes. Without
            // it, fall back to Yahoo's own previous close and leave week/month blank.
            [$timestamps, $closes] = $daily !== null ? chartSeries($daily) : [[], []];

            $price = (float) $price;
            $marketTime = is_numeric($meta['regularMarketTime'] ?? null)
                ? (int) $meta['regularMarketTime']
                : $now;
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

            $tradingPeriod = $meta['currentTradingPeriod'] ?? null;
            if (is_array($tradingPeriod)) {
                $regular = sessionBounds($tradingPeriod['regular'] ?? null);
                if ($regular !== null && $now >= $regular[0] && $now < $regular[1]) {
                    $marketOpen = true;
                }
                foreach (['pre', 'regular', 'post'] as $periodKey) {
                    $bounds = sessionBounds($tradingPeriod[$periodKey] ?? null);
                    if ($bounds !== null && $now >= $bounds[0] && $now < $bounds[1]) {
                        $tradingActive = true;
                    }
                }

                // The status badge follows one exchange: New York when any stock trades
                // there, otherwise the first stock's exchange.
                if ($marketReference === null || ($timezone === 'America/New_York' && $marketReference['timezone'] !== 'America/New_York')) {
                    $marketReference = [
                        'periods' => $tradingPeriod,
                        'timezone' => $timezone,
                        'exchange' => (string) ($meta['fullExchangeName'] ?? $meta['exchangeName'] ?? ''),
                    ];
                }
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
                $extendedErrors[$symbol] = $minuteResponse->error ?? 'No extended-hours chart was available for this symbol.';
                continue;
            }
            $extendedQuotes[$symbol] = $this->extendedQuote($minute, $price, $now);
        }

        return [
            'quotes' => $quotes,
            'fxRates' => (object) $this->exchangeRates($quotes),
            'errors' => $errors,
            'extendedQuotes' => $extendedQuotes,
            'extendedErrors' => $extendedErrors,
            'marketOpen' => $marketOpen,
            'tradingActive' => $tradingActive,
            'market' => $marketReference === null
                ? null
                : marketStatus($marketReference['periods'], $marketReference['timezone'], $marketReference['exchange'], $now),
            'rateLimited' => $this->yahoo->wasRateLimited(),
            'fetchedAt' => gmdate(DATE_ATOM, $now),
        ];
    }

    /**
     * Pre-market and after-hours prices, and today's chart points, from the
     * 1-minute chart.
     */
    private function extendedQuote(array $minute, float $price, int $now): array
    {
        [$timestamps, $closes] = chartSeries($minute);
        $periods = $minute['meta']['tradingPeriods'] ?? [];

        // After the close, end the chart on the official closing price so it
        // matches the Price column rather than the last 1-minute trade.
        $intraday = intradayPoints($timestamps, $closes, $periods['regular'] ?? null);
        $regularBounds = sessionBounds(is_array($periods['regular'] ?? null) ? ($periods['regular'][0][0] ?? null) : null);
        if ($intraday !== [] && $regularBounds !== null && $now >= $regularBounds[1]) {
            $intraday[] = [$regularBounds[1], round($price, 4)];
        }

        return [
            'preMarket' => latestSessionQuote($timestamps, $closes, $periods['pre'] ?? null),
            'afterHours' => latestSessionQuote($timestamps, $closes, $periods['post'] ?? null),
            'activeSession' => activeExtendedSession($periods, $now),
            'intraday' => $intraday,
            // [start, end] of the regular session the intraday points belong to,
            // so a chart can span the whole trading day.
            'regularSession' => $regularBounds,
        ];
    }

    /**
     * Exchange rates to kronor for the currencies the stocks are priced in, so
     * the page can show the portfolio's value in SEK, e.g. ['USD' => 9.97].
     *
     * @return array<string, float>
     */
    private function exchangeRates(array $quotes): array
    {
        $requests = [];
        foreach (currenciesToConvert($quotes) as $currency) {
            $requests[$currency] = ['symbol' => fxSymbol($currency), 'query' => ['range' => '1d', 'interval' => '1d'], 'cacheSeconds' => self::FX_CACHE_SECONDS];
        }

        $rates = [];
        foreach ($this->yahoo->charts($requests) as $currency => $response) {
            $rate = $response->result !== null ? fxRate($response->result) : null;
            if ($rate !== null) {
                $rates[$currency] = $rate;
            }
        }

        return $rates;
    }
}
