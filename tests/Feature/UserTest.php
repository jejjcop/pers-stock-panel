<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The User model: the pause after wrong passwords, and saving and reading
 * the stock lists.
 */
class UserTest extends TestCase
{
    use RefreshDatabase;

    public function testThePauseDoublesUpToFifteenMinutes(): void
    {
        $this->assertSame([0, 30, 60, 120, 900, 900], array_map([User::class, 'lockSeconds'], [4, 5, 6, 7, 10, 20]));
    }

    public function testWrongPasswordsPauseLoggingIn(): void
    {
        $user = User::factory()->create();

        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $user->recordFailedLogin();
        }

        $this->assertSame(5, $user->fresh()->failed_logins);
        $this->assertSame(30, $user->fresh()->secondsUntilUnlocked());

        $user->recordSuccessfulLogin();
        $this->assertSame(0, $user->fresh()->failed_logins);
        $this->assertSame(0, $user->fresh()->secondsUntilUnlocked());
    }

    public function testSavedStocksReadBackInTheSameOrder(): void
    {
        $user = User::factory()->create();
        $portfolio = normalizePortfolio([
            'stocks' => [['ticker' => 'NVDA', 'list' => 'monitor'], ['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'AAPL', 'list' => 'owned']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5], 'AAPL' => ['shares' => 10, 'cost' => null]],
        ]);

        $user->savePortfolio($portfolio);

        $this->assertSame($portfolio, $user->fresh()->portfolio());
    }

    public function testSavingReplacesTheStocksSavedBefore(): void
    {
        $user = User::factory()->create();
        $user->savePortfolio(normalizePortfolio(['stocks' => [['ticker' => 'MU', 'list' => 'owned']]]));

        $user->savePortfolio(normalizePortfolio(['stocks' => [['ticker' => 'NVDA', 'list' => 'owned']]]));

        $this->assertSame([['ticker' => 'NVDA', 'list' => 'owned']], $user->fresh()->portfolio()['stocks']);
        $this->assertDatabaseCount('stocks', 1);
    }

    public function testEmptyListsStayEmptyOnceSaved(): void
    {
        $user = User::factory()->create();
        $this->assertCount(5, $user->portfolio()['stocks'], 'the built-in stocks before anything is saved');

        $user->savePortfolio(normalizePortfolio(['stocks' => []]));

        $this->assertSame(['stocks' => [], 'holdings' => []], $user->fresh()->portfolio());
    }
}
