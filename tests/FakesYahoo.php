<?php

namespace Tests;

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

/**
 * Made-up Yahoo Finance chart answers, and Http::fake() set up to give them,
 * for a made-up Wednesday, 21 October 2026, at 14:00 in New York (market
 * open).
 */
trait FakesYahoo
{
    /** The answers fakeYahoo() was last given. */
    private array $yahooAnswers;

    protected function now(): int
    {
        return nyTime('2026-10-21 14:00');
    }

    /** Yahoo's trading periods for that day, in the flat shape of currentTradingPeriod. */
    protected function currentTradingPeriod(): array
    {
        return [
            'pre' => ['start' => nyTime('2026-10-21 04:00'), 'end' => nyTime('2026-10-21 09:30')],
            'regular' => ['start' => nyTime('2026-10-21 09:30'), 'end' => nyTime('2026-10-21 16:00')],
            'post' => ['start' => nyTime('2026-10-21 16:00'), 'end' => nyTime('2026-10-21 20:00')],
        ];
    }

    /** A chart answer as Yahoo sends it. */
    protected function chart(array $meta, array $timestamps = [], array $closes = []): array
    {
        return ['chart' => ['result' => [[
            'meta' => $meta,
            'timestamp' => $timestamps,
            'indicators' => ['quote' => [['close' => $closes]]],
        ]], 'error' => null]];
    }

    /**
     * MU's daily closes: 1,000 two weeks ago, 1,020 a week ago (Tuesday),
     * 1,045.56 yesterday, and today's so far.
     */
    protected function dailyChart(): array
    {
        $days = ['2026-10-07', '2026-10-14', '2026-10-20', '2026-10-21'];

        return $this->chart(
            ['regularMarketPrice' => 1088, 'currency' => 'USD', 'exchangeTimezoneName' => 'America/New_York', 'previousClose' => 1000],
            array_map(static fn (string $day): int => nyTime("{$day} 09:30"), $days),
            [1000, 1020, 1045.56, 1088]
        );
    }

    /** MU's 1-minute bars for today: a pre-market trade, then regular hours. */
    protected function minuteChart(): array
    {
        $periods = $this->currentTradingPeriod();

        return $this->chart(
            [
                'regularMarketPrice' => 1088,
                'regularMarketTime' => $this->now() - 60,
                'regularMarketVolume' => 12_345_678,
                'currency' => 'USD',
                'exchangeTimezoneName' => 'America/New_York',
                'fullExchangeName' => 'NasdaqGS',
                'longName' => 'Micron Technology, Inc.',
                'currentTradingPeriod' => $periods,
                // The nested shape Yahoo uses in tradingPeriods.
                'tradingPeriods' => array_map(static fn (array $period): array => [[$period]], $periods),
            ],
            [nyTime('2026-10-21 09:00'), nyTime('2026-10-21 09:30'), nyTime('2026-10-21 11:00'), nyTime('2026-10-21 13:59')],
            [1050, 1046, 1070, 1088]
        );
    }

    protected function exchangeRateChart(float $rate): array
    {
        return $this->chart(['regularMarketPrice' => $rate, 'currency' => 'SEK']);
    }

    /**
     * Answers Yahoo chart requests from $answers, keyed 'SYMBOL interval',
     * e.g. 'MU 1d'. A value is the JSON to answer with, or a callable that
     * makes the answer (e.g. a 429 or a failed connection).
     */
    protected function fakeYahoo(array $answers): void
    {
        // Called again in a test, it changes the answers: Laravel keeps using
        // the first Http::fake(), so that one reads them from here.
        $firstTime = !isset($this->yahooAnswers);
        $this->yahooAnswers = $answers;
        if (!$firstTime) {
            return;
        }

        Http::fake(function (Request $request) {
            $symbol = rawurldecode(basename(parse_url($request->url(), PHP_URL_PATH)));
            $answer = $this->yahooAnswers["{$symbol} {$request->data()['interval']}"] ?? null;
            if ($answer === null) {
                return Http::response(['chart' => ['result' => null, 'error' => ['code' => 'Not Found']]], 404);
            }

            return is_callable($answer) ? $answer() : Http::response($answer);
        });
    }

    /** The usual answers: MU's charts and a dollar at 10.50 kronor. */
    protected function fakeYahooForMu(): void
    {
        $this->fakeYahoo([
            'MU 1d' => $this->dailyChart(),
            'MU 1m' => $this->minuteChart(),
            'USDSEK=X 1d' => $this->exchangeRateChart(10.5),
        ]);
    }

    /** How many requests went to Yahoo for this symbol and bar size. */
    protected function requestsFor(string $symbol, string $interval): int
    {
        return Http::recorded(static fn (Request $request) => str_contains($request->url(), '/chart/' . rawurlencode($symbol) . '?')
            && ($request->data()['interval'] ?? null) === $interval)->count();
    }
}
