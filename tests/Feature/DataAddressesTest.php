<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The addresses the page fetches data from: /quotes, /history and /portfolio.
 * These tests stop before anything would be asked from Yahoo Finance.
 */
class DataAddressesTest extends TestCase
{
    use RefreshDatabase;

    public function testGiveNothingAwayWithoutALogin(): void
    {
        $this->getJson('/quotes?symbols=MU')->assertStatus(401)->assertExactJson(['error' => 'You are not logged in.']);
        $this->getJson('/history?symbol=MU&range=1d')->assertStatus(401);
        $this->postJson('/portfolio', ['stocks' => [], 'holdings' => []])->assertStatus(401);

        $this->assertDatabaseCount('stocks', 0);
    }

    public function testQuotesRefuseMissingOrInvalidSymbols(): void
    {
        $this->actingAs(User::factory()->create());

        $this->getJson('/quotes')->assertStatus(400)->assertJson(['error' => 'Provide between 1 and 25 stock symbols.']);
        $this->getJson('/quotes?symbols=MU,not%20a%20ticker')->assertStatus(400)->assertJson(['error' => 'One or more stock symbols have an invalid format.']);
    }

    public function testHistoryRefusesAnInvalidSymbolOrPeriod(): void
    {
        $this->actingAs(User::factory()->create());

        $this->getJson('/history?symbol=%3Cb%3E&range=1d')->assertStatus(400)->assertJson(['error' => 'The stock symbol has an invalid format.']);
        $this->getJson('/history?symbol=MU&range=2d')->assertStatus(400)->assertJson(['error' => 'Choose one of the periods 1d, 1w, 1m, 1y, 5y.']);
    }

    public function testSavesThePortfolio(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/portfolio', [
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ])->assertOk()->assertJsonStructure(['savedAt']);

        $this->assertDatabaseHas('stocks', ['user_id' => $user->id, 'ticker' => 'MU', 'list' => 'owned', 'position' => 0, 'shares' => 19, 'cost' => 989.5]);
        $this->assertDatabaseHas('stocks', ['user_id' => $user->id, 'ticker' => 'NVDA', 'list' => 'monitor', 'position' => 1, 'shares' => null]);
        $this->assertNotNull($user->fresh()->portfolio_saved_at);
    }

    public function testRefusesToSaveAnythingButAValidStockList(): void
    {
        $this->actingAs(User::factory()->create());

        $this->postJson('/portfolio', ['stocks' => [['ticker' => 'not a ticker', 'list' => 'owned']], 'holdings' => []])
            ->assertStatus(400);
        $this->post('/portfolio', ['stocks' => []])->assertStatus(415);
        $this->call('POST', '/portfolio', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{not json')
            ->assertStatus(400)->assertJson(['error' => 'The data is not valid JSON.']);

        $this->assertDatabaseCount('stocks', 0);
    }
}
