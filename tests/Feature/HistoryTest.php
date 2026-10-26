<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\FakesYahoo;
use Tests\TestCase;

/**
 * The large chart's price history (/history), from made-up Yahoo answers.
 */
class HistoryTest extends TestCase
{
    use FakesYahoo;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::factory()->create());
    }

    private function dayChart(): array
    {
        return $this->chart(
            ['currency' => 'USD', 'chartPreviousClose' => 1045.56],
            [nyTime('2026-10-21 09:30'), nyTime('2026-10-21 09:35'), nyTime('2026-10-21 09:40')],
            [1040, null, 1060]
        );
    }

    public function testGivesThePointsAndYesterdaysClose(): void
    {
        $this->fakeYahoo(['MU 5m' => $this->dayChart()]);

        $this->getJson('/history?symbol=MU&range=1d')
            ->assertOk()
            ->assertExactJson([
                'symbol' => 'MU',
                'range' => '1d',
                'currency' => 'USD',
                'previousClose' => 1045.56,
                // The bar without a close is left out.
                'points' => [[nyTime('2026-10-21 09:30'), 1040], [nyTime('2026-10-21 09:40'), 1060]],
            ]);
    }

    public function testLongerPeriodsHaveNoPreviousClose(): void
    {
        $this->fakeYahoo(['MU 1d' => $this->dayChart()]);

        $this->getJson('/history?symbol=MU&range=1y')->assertOk()->assertJsonPath('previousClose', null);
    }

    public function testReusesADownloadedChartForAMinute(): void
    {
        $this->fakeYahoo(['MU 5m' => $this->dayChart()]);

        $this->getJson('/history?symbol=MU&range=1d')->assertOk();
        $this->getJson('/history?symbol=MU&range=1d')->assertOk();
        $this->assertSame(1, $this->requestsFor('MU', '5m'));

        $this->travel(61)->seconds();
        $this->getJson('/history?symbol=MU&range=1d')->assertOk();
        $this->assertSame(2, $this->requestsFor('MU', '5m'));
    }

    public function testPassesOnWhyThereIsNoChart(): void
    {
        $this->fakeYahoo(['MU 5m' => fn () => Http::response('', 429)]);
        $this->getJson('/history?symbol=MU&range=1d')
            ->assertStatus(429)
            ->assertExactJson(['error' => 'Yahoo Finance is temporarily rate-limiting requests.']);

        $this->fakeYahoo(['MU 5m' => fn () => Http::response('', 503)]);
        $this->getJson('/history?symbol=MU&range=1d')
            ->assertStatus(502)
            ->assertExactJson(['error' => 'Yahoo Finance returned HTTP 503.']);
    }
}
