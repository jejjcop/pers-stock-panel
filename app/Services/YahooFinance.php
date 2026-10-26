<?php

namespace App\Services;

use Composer\CaBundle\CaBundle;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Downloads charts from Yahoo Finance's unofficial chart endpoint, several
 * at the same time, and keeps them in Laravel's cache for as long as each
 * request allows.
 *
 * A service: a class with one job, which controllers and other services get
 * from Laravel (see QuoteBoard's constructor) instead of creating it
 * themselves. In tests, Http::fake() answers in Yahoo's place.
 */
class YahooFinance
{
    private const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

    /** Whether Yahoo refused a request in this refresh for asking too often. */
    private bool $rateLimited = false;

    /**
     * Gets several charts, from the cache where allowed, and downloads the
     * rest at the same time.
     *
     * @param array<string, array{symbol: string, query: array<string, string>, cacheSeconds?: int}> $requests
     *     keyed by any name the caller chooses, e.g. 'daily:MU'. With
     *     cacheSeconds, a chart downloaded less than that long ago is reused.
     * @return array<string, ChartResponse> keyed like $requests
     */
    public function charts(array $requests): array
    {
        $responses = [];
        $toDownload = [];
        foreach ($requests as $key => $request) {
            $cached = ($request['cacheSeconds'] ?? 0) > 0 ? Cache::get($this->cacheKey($request)) : null;
            if (is_array($cached)) {
                $responses[$key] = new ChartResponse($cached, fromCache: true);
            } else {
                $toDownload[$key] = $request;
            }
        }

        if ($toDownload !== []) {
            // All downloads run at the same time; this waits for the last one.
            $answers = Http::pool(fn (Pool $pool) => array_map(
                fn (string $key) => $this->chartRequest($pool->as($key), $toDownload[$key]),
                array_keys($toDownload)
            ));

            foreach ($toDownload as $key => $request) {
                $response = $this->readAnswer($answers[$key] ?? null);
                if ($response->result !== null && ($request['cacheSeconds'] ?? 0) > 0) {
                    Cache::put($this->cacheKey($request), $response->result, $request['cacheSeconds']);
                }
                $responses[$key] = $response;
            }
        }

        // In the same order as the requests.
        return array_map(fn (string $key) => $responses[$key], array_combine(array_keys($requests), array_keys($requests)));
    }

    public function wasRateLimited(): bool
    {
        return $this->rateLimited;
    }

    /**
     * A request set up the way Yahoo accepts it: like a browser, with short
     * time limits so one slow answer cannot hold up the page.
     */
    private function chartRequest($request, array $chart)
    {
        return $request
            // The certificates to trust for HTTPS: the computer's own list
            // where PHP can find one, otherwise the copy in composer/ca-bundle
            // (on Windows, PHP's cURL finds none by itself).
            ->withOptions(['verify' => CaBundle::getSystemCaRootBundlePath()])
            ->withUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
            ->withHeaders(['Referer' => 'https://finance.yahoo.com/'])
            ->acceptJson()
            ->connectTimeout(5)
            ->timeout(12)
            ->get(self::CHART_URL . rawurlencode($chart['symbol']), $chart['query']);
    }

    /** Turns Yahoo's answer, or the reason there was none, into a ChartResponse. */
    private function readAnswer(mixed $answer): ChartResponse
    {
        if ($answer instanceof ConnectionException || !$answer instanceof Response) {
            return ChartResponse::failed('Network error while contacting Yahoo Finance.');
        }
        if ($answer->status() === 429) {
            $this->rateLimited = true;
            return ChartResponse::failed('Yahoo Finance is temporarily rate-limiting requests.');
        }
        if ($answer->status() !== 200) {
            return ChartResponse::failed("Yahoo Finance returned HTTP {$answer->status()}.");
        }

        $result = chartResult($answer->body());

        return $result === null
            ? ChartResponse::failed('Yahoo Finance returned an unexpected response.')
            : new ChartResponse($result);
    }

    private function cacheKey(array $request): string
    {
        return 'yahoo-chart:' . $request['symbol'] . '?' . http_build_query($request['query']);
    }
}
