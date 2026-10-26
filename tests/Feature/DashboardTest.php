<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The main page, sent through Laravel the way a browser request would be.
 */
class DashboardTest extends TestCase
{
    // Every test starts with an empty database (in memory, never the real one).
    use RefreshDatabase;

    public function testSendsYouToTheLoginPageUntilYouLogIn(): void
    {
        $this->get('/')->assertRedirect('/login')->assertStatus(303);
    }

    public function testShowsYourStocksOnceLoggedIn(): void
    {
        $user = User::factory()->create();
        $user->savePortfolio(normalizePortfolio([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ]));

        // actingAs() sends the request as this user, as if logged in.
        $response = $this->actingAs($user)->get('/');

        $response->assertOk();
        $response->assertViewIs('dashboard');
        $response->assertSee('My current stocks');
        $response->assertSee('Stocks to monitor');
        // The data public/app.js builds the table rows from.
        $pageData = $response->viewData('pageData');
        $this->assertFalse($pageData['isNew']);
        $this->assertSame(
            [['ticker' => 'MU', 'list' => 'owned', 'name' => null], ['ticker' => 'NVDA', 'list' => 'monitor', 'name' => 'NVIDIA Corp.']],
            $pageData['stocks']
        );
        $this->assertEquals((object) ['MU' => ['shares' => 19.0, 'cost' => 989.5]], $pageData['holdings']);
    }

    public function testStartsWithTheBuiltInStocksUntilSomethingIsSaved(): void
    {
        $pageData = $this->actingAs(User::factory()->create())->get('/')->viewData('pageData');

        $this->assertTrue($pageData['isNew']);
        $this->assertSame(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'], array_column($pageData['stocks'], 'ticker'));
    }
}
