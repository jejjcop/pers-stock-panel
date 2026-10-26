<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Facades\DB;

/**
 * The app's single user, with their stock lists.
 *
 * An Eloquent model: each User object is a row in the users table, and
 * $user->save() writes its changes back.
 */
#[Fillable(['name', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory;

    public const PASSWORD_MIN_LENGTH = 8;
    // Wrong passwords allowed before logging in is paused for a while.
    private const FREE_ATTEMPTS = 5;
    private const FIRST_LOCK_SECONDS = 30;
    private const MAX_LOCK_SECONDS = 900;

    protected function casts(): array
    {
        return [
            // Anything put in 'password' is hashed before it is saved.
            'password' => 'hashed',
            'failed_logins' => 'integer',
            'locked_until' => 'datetime',
            'portfolio_saved_at' => 'datetime',
        ];
    }

    /**
     * The user's stocks, in the order the page last had them. A
     * relationship: $user->stocks gives them as Stock objects.
     *
     * @return HasMany<Stock, $this>
     */
    public function stocks(): HasMany
    {
        return $this->hasMany(Stock::class)->orderBy('position');
    }

    /**
     * How long logging in is paused after this many wrong passwords in a
     * row: nothing for the first few, then 30 seconds, doubling up to 15
     * minutes.
     */
    public static function lockSeconds(int $failedLogins): int
    {
        if ($failedLogins < self::FREE_ATTEMPTS) {
            return 0;
        }

        return min(self::MAX_LOCK_SECONDS, self::FIRST_LOCK_SECONDS * 2 ** ($failedLogins - self::FREE_ATTEMPTS));
    }

    /** Seconds left before the next password may be tried; 0 when now. */
    public function secondsUntilUnlocked(): int
    {
        return $this->locked_until === null ? 0 : max(0, $this->locked_until->getTimestamp() - now()->getTimestamp());
    }

    public function recordFailedLogin(): void
    {
        $this->failed_logins += 1;
        $this->locked_until = now()->addSeconds(self::lockSeconds($this->failed_logins));
        $this->save();
    }

    public function recordSuccessfulLogin(): void
    {
        $this->failed_logins = 0;
        $this->locked_until = null;
        $this->save();
    }

    /**
     * The stock lists and holdings in the shape public/app.js uses, or the
     * built-in stocks when nothing has been saved yet.
     *
     * @return array{stocks: array<int, array{ticker: string, list: string}>, holdings: array<string, array{shares: ?float, cost: ?float}>}
     */
    public function portfolio(): array
    {
        if ($this->portfolio_saved_at === null) {
            return defaultPortfolio();
        }

        $portfolio = ['stocks' => [], 'holdings' => []];
        foreach ($this->stocks as $stock) {
            $portfolio['stocks'][] = ['ticker' => $stock->ticker, 'list' => $stock->list];
            if ($stock->shares !== null || $stock->cost !== null) {
                $portfolio['holdings'][$stock->ticker] = ['shares' => $stock->shares, 'cost' => $stock->cost];
            }
        }

        return $portfolio;
    }

    /**
     * Replaces the saved stock lists with these, already checked by
     * normalizePortfolio(). In a transaction: if anything fails, nothing
     * is changed.
     */
    public function savePortfolio(array $portfolio): void
    {
        DB::transaction(function () use ($portfolio) {
            $this->stocks()->delete();
            foreach ($portfolio['stocks'] as $position => $stock) {
                $holding = $portfolio['holdings'][$stock['ticker']] ?? null;
                $this->stocks()->create([
                    'ticker' => $stock['ticker'],
                    'list' => $stock['list'],
                    'position' => $position,
                    'shares' => $holding['shares'] ?? null,
                    'cost' => $holding['cost'] ?? null,
                ]);
            }
            $this->portfolio_saved_at = now();
            $this->save();
        });

        // Forget the stocks loaded before, so $this->stocks reads them again.
        $this->unsetRelation('stocks');
    }
}
