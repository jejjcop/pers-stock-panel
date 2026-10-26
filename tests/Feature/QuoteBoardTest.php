<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\QuoteBoard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\FakesYahoo;
use Tests\TestCase;

/**
 * The price overview the page fetches from /quotes, built from made-up
 * Yahoo Finance answers (see FakesYahoo).
 */
class QuoteBoardTest extends TestCase
{
    use FakesYahoo;
    use RefreshDatabase;

    /** Builds the overview for these stocks, at the made-up moment. */
    private function build(array $symbols = ['MU']): array
    {
        // app() asks Laravel for a QuoteBoard, with its YahooFinance service.
        return app(QuoteBoard::class)->build($symbols, $this->now());
    }

    public function testWorksOutTheQuoteFromYahoosCharts(): void
    {
        $this->fakeYahooForMu();

        $board = $this->build();

        $quote = $board['quotes']['MU'];
        $this->assertSame('Micron Technology, Inc.', $quote['name']);
        $this->assertSame(1088.0, $quote['price']);
        // Yesterday's close, from the daily chart.
        $this->assertSame(1045.56, $quote['previousClose']);
        $this->assertEqualsWithDelta((1088 - 1045.56) / 1045.56 * 100, $quote['changePct'], 1e-9);
        // Against last Tuesday's close; there is no close from a month ago.
        $this->assertEqualsWithDelta((1088 - 1020) / 1020 * 100, $quote['weekChangePct'], 1e-9);
        $this->assertNull($quote['monthChangePct']);
        $this->assertSame(12_345_678.0, $quote['volume']);

        $extended = $board['extendedQuotes']['MU'];
        $this->assertSame(['price' => 1050.0, 'time' => nyTime('2026-10-21 09:00')], $extended['preMarket']);
        $this->assertNull($extended['activeSession']);
        // Only regular hours are on today's chart.
        $this->assertSame([[nyTime('2026-10-21 09:30'), 1046.0], [nyTime('2026-10-21 11:00'), 1070.0], [nyTime('2026-10-21 13:59'), 1088.0]], $extended['intraday']);
        $this->assertSame([nyTime('2026-10-21 09:30'), nyTime('2026-10-21 16:00')], $extended['regularSession']);

        $this->assertEquals((object) ['USD' => 10.5], $board['fxRates']);
        $this->assertTrue($board['marketOpen']);
        $this->assertSame('open', $board['market']['session']);
        $this->assertSame([], $board['errors']);
        $this->assertFalse($board['rateLimited']);
    }

    public function testReusesDailyClosesForFiveMinutesAndRatesForOne(): void
    {
        $this->fakeYahooForMu();

        $this->build();
        $this->build();

        // The live 1-minute chart is downloaded every time...
        $this->assertSame(2, $this->requestsFor('MU', '1m'));
        // ...but the daily closes and the exchange rate come from the cache.
        $this->assertSame(1, $this->requestsFor('MU', '1d'));
        $this->assertSame(1, $this->requestsFor('USDSEK=X', '1d'));

        // travel() moves the clock Laravel's cache follows.
        $this->travel(61)->seconds();
        $this->build();
        $this->assertSame(1, $this->requestsFor('MU', '1d'));
        $this->assertSame(2, $this->requestsFor('USDSEK=X', '1d'));

        $this->travel(5)->minutes();
        $this->build();
        $this->assertSame(2, $this->requestsFor('MU', '1d'));
    }

    public function testSaysWhenYahooIsLimitingRequests(): void
    {
        $this->fakeYahoo([
            'MU 1d' => fn () => Http::response('', 429),
            'MU 1m' => fn () => Http::response('', 429),
        ]);

        $board = $this->build();

        $this->assertTrue($board['rateLimited']);
        $this->assertSame([], $board['quotes']);
        $this->assertSame(['MU' => 'Yahoo Finance is temporarily rate-limiting requests.'], $board['errors']);
    }

    public function testSaysWhenYahooCannotBeReached(): void
    {
        $this->fakeYahoo([
            'MU 1d' => fn () => Http::failedConnection(),
            'MU 1m' => fn () => Http::failedConnection(),
        ]);

        $board = $this->build();

        $this->assertSame(['MU' => 'Network error while contacting Yahoo Finance.'], $board['errors']);
        $this->assertFalse($board['rateLimited']);
    }

    public function testFallsBackToDailyDataDownloadedJustNow(): void
    {
        $this->fakeYahoo([
            'MU 1d' => $this->dailyChart(),
            'MU 1m' => fn () => Http::response('Server error', 500),
        ]);

        $board = $this->build();

        // The quote, without the extended-hours part.
        $this->assertSame(1088.0, $board['quotes']['MU']['price']);
        $this->assertSame(['MU' => 'Yahoo Finance returned HTTP 500.'], $board['extendedErrors']);
    }

    public function testDoesNotPassOffCachedDailyDataAsCurrent(): void
    {
        $this->fakeYahooForMu();
        $this->build();

        $this->fakeYahoo(['MU 1m' => fn () => Http::response('Server error', 500)]);
        $board = $this->build();

        $this->assertSame([], $board['quotes']);
        $this->assertSame(['MU' => 'Yahoo Finance returned HTTP 500.'], $board['errors']);
    }

    public function testRefusesAnswersWithoutChartData(): void
    {
        $this->fakeYahoo(['MU 1d' => ['unexpected' => true], 'MU 1m' => ['unexpected' => true]]);

        $this->assertSame(['MU' => 'Yahoo Finance returned an unexpected response.'], $this->build()['errors']);
    }

    public function testTheQuotesAddressAnswersWithTheOverview(): void
    {
        $this->fakeYahooForMu();

        $this->actingAs(User::factory()->create())
            ->getJson('/quotes?symbols=mu')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('quotes.MU.name', 'Micron Technology, Inc.')
            ->assertJsonPath('fxRates.USD', 10.5);
    }
}
