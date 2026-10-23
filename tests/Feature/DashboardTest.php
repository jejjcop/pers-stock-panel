<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * The main page, sent through Laravel the way a browser request would be.
 */
class DashboardTest extends TestCase
{
    private string $dataDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        // A data folder of the test's own, never data/portfolio.json.
        $this->dataDirectory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'stock-panel-dashboard-test-' . bin2hex(random_bytes(6));
        mkdir($this->dataDirectory);
        putenv('STOCK_PANEL_DATA_DIR=' . $this->dataDirectory);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->dataDirectory . DIRECTORY_SEPARATOR . '*') ?: []);
        rmdir($this->dataDirectory);
        putenv('STOCK_PANEL_DATA_DIR');
        $_SESSION = [];

        parent::tearDown();
    }

    public function testSendsYouToTheLoginPageUntilYouLogIn(): void
    {
        $this->get('/')->assertRedirect('login.php')->assertStatus(303);
    }

    public function testShowsYourStocksOnceLoggedIn(): void
    {
        file_put_contents($this->dataDirectory . DIRECTORY_SEPARATOR . 'portfolio.json', json_encode([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ]));
        $_SESSION['loggedIn'] = true;

        $response = $this->get('/');

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
