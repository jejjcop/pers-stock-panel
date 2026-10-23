<?php

namespace Tests\Feature;

use Tests\TestCase;
use Tests\UsesTemporaryDataFolder;

/**
 * The addresses the page fetches data from: /quotes, /history and /portfolio.
 * These tests stop before anything would be asked from Yahoo Finance.
 */
class DataAddressesTest extends TestCase
{
    use UsesTemporaryDataFolder;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDataFolder();
    }

    protected function tearDown(): void
    {
        $this->tearDownDataFolder();
        parent::tearDown();
    }

    public function testGiveNothingAwayWithoutALogin(): void
    {
        $this->getJson('/quotes?symbols=MU')->assertStatus(401)->assertExactJson(['error' => 'You are not logged in.']);
        $this->getJson('/history?symbol=MU&range=1d')->assertStatus(401);
        $this->postJson('/portfolio', ['stocks' => [], 'holdings' => []])->assertStatus(401);

        $this->assertFileDoesNotExist($this->dataFile('portfolio.json'));
    }

    public function testQuotesRefuseMissingOrInvalidSymbols(): void
    {
        $this->withSession(['logged_in' => true]);

        $this->getJson('/quotes')->assertStatus(400)->assertJson(['error' => 'Provide between 1 and 25 stock symbols.']);
        $this->getJson('/quotes?symbols=MU,not%20a%20ticker')->assertStatus(400)->assertJson(['error' => 'One or more stock symbols have an invalid format.']);
    }

    public function testHistoryRefusesAnInvalidSymbolOrPeriod(): void
    {
        $this->withSession(['logged_in' => true]);

        $this->getJson('/history?symbol=%3Cb%3E&range=1d')->assertStatus(400)->assertJson(['error' => 'The stock symbol has an invalid format.']);
        $this->getJson('/history?symbol=MU&range=2d')->assertStatus(400)->assertJson(['error' => 'Choose one of the periods 1d, 1w, 1m, 1y, 5y.']);
    }

    public function testSavesThePortfolio(): void
    {
        $this->withSession(['logged_in' => true]);

        $this->postJson('/portfolio', [
            'stocks' => [['ticker' => 'MU', 'list' => 'owned']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ])->assertOk()->assertJsonStructure(['savedAt']);

        $this->assertSame([['ticker' => 'MU', 'list' => 'owned']], loadPortfolio($this->dataFile('portfolio.json'))['stocks']);
    }

    public function testRefusesToSaveAnythingButAValidStockList(): void
    {
        $this->withSession(['logged_in' => true]);

        $this->postJson('/portfolio', ['stocks' => [['ticker' => 'not a ticker', 'list' => 'owned']], 'holdings' => []])
            ->assertStatus(400);
        $this->post('/portfolio', ['stocks' => []])->assertStatus(415);
        $this->call('POST', '/portfolio', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{not json')
            ->assertStatus(400)->assertJson(['error' => 'The data is not valid JSON.']);

        $this->assertFileDoesNotExist($this->dataFile('portfolio.json'));
    }
}
