<?php

namespace Tests\Feature;

use Tests\TestCase;
use Tests\UsesTemporaryDataFolder;

/**
 * The main page, sent through Laravel the way a browser request would be.
 */
class DashboardTest extends TestCase
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

    public function testSendsYouToTheLoginPageUntilYouLogIn(): void
    {
        $this->get('/')->assertRedirect('/login')->assertStatus(303);
    }

    public function testShowsYourStocksOnceLoggedIn(): void
    {
        $this->writeDataFile('portfolio.json', [
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ]);

        // withSession() starts the request with this in Laravel's session,
        // as if the browser had logged in before.
        $response = $this->withSession(['logged_in' => true])->get('/');

        $response->assertOk();
        $response->assertViewIs('dashboard');
        $response->assertSee('My current stocks');
        $response->assertSee('Stocks to monitor');
        // The data public/app.js builds the table rows from.
        $this->assertSame(
            [['ticker' => 'MU', 'list' => 'owned', 'name' => null], ['ticker' => 'NVDA', 'list' => 'monitor', 'name' => 'NVIDIA Corp.']],
            $response->viewData('pageData')['stocks']
        );
    }
}
