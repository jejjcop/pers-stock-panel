<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;
use Tests\UsesTemporaryDataFolder;

/**
 * php artisan stock-panel:import-json: copying what older versions saved in
 * auth.json and portfolio.json into the database.
 */
class ImportJsonDataTest extends TestCase
{
    use RefreshDatabase;
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

    private function writeOldFiles(): void
    {
        // A hash made by the old version (PHP's own password_hash, cost 12).
        $this->writeDataFile('auth.json', ['passwordHash' => password_hash('the-password', PASSWORD_BCRYPT, ['cost' => 12]), 'failedAttempts' => 2, 'lockedUntil' => 0]);
        $this->writeDataFile('portfolio.json', [
            'savedAt' => '2026-10-01T12:00:00+00:00',
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ]);
    }

    public function testCopiesThePasswordAndStocks(): void
    {
        $this->writeOldFiles();

        // artisan() runs a command the way `php artisan ...` would.
        $this->artisan('stock-panel:import-json')
            ->expectsOutput('Imported the password and 2 stocks into the database.')
            ->assertSuccessful();

        $user = User::query()->sole();
        $this->assertTrue(Hash::check('the-password', $user->password));
        $this->assertSame(2, $user->failed_logins);
        $this->assertSame([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19.0, 'cost' => 989.5]],
        ], $user->portfolio());
        // The old files stay, as a backup.
        $this->assertFileExists($this->dataFile('portfolio.json'));
    }

    public function testTheOldPasswordLogsIn(): void
    {
        $this->writeOldFiles();
        $this->artisan('stock-panel:import-json')->assertSuccessful();

        $this->post('/login', ['password' => 'the-password'])->assertRedirect('/');

        $this->assertAuthenticated();
    }

    public function testDoesNothingTheSecondTime(): void
    {
        $this->writeOldFiles();
        $this->artisan('stock-panel:import-json')->assertSuccessful();

        $this->artisan('stock-panel:import-json')
            ->expectsOutput('The database already has the password and stocks; nothing to import.')
            ->assertSuccessful();

        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('stocks', 2);
    }

    public function testWithoutAPasswordTheAppAsksForOne(): void
    {
        $this->artisan('stock-panel:import-json')->assertSuccessful();

        $this->assertDatabaseCount('users', 0);
    }

    public function testAPasswordWithoutSavedStocksStartsWithTheBuiltInOnes(): void
    {
        $this->writeOldFiles();
        unlink($this->dataFile('portfolio.json'));

        $this->artisan('stock-panel:import-json')->expectsOutput('Imported the password into the database.')->assertSuccessful();

        $this->assertNull(User::query()->sole()->portfolio_saved_at);
    }

    public function testRefusesADamagedStockFile(): void
    {
        $this->writeOldFiles();
        $this->writeDataFile('portfolio.json', '{"stocks": [');

        $this->artisan('stock-panel:import-json')->assertFailed();

        $this->assertDatabaseCount('users', 0);
    }
}
