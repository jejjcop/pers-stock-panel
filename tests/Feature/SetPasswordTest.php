<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * php artisan stock-panel:set-password, for a forgotten password.
 */
class SetPasswordTest extends TestCase
{
    use RefreshDatabase;

    public function testReplacesTheForgottenPasswordAndKeepsTheStocks(): void
    {
        $user = User::factory()->create(['password' => 'forgotten-one']);
        $user->savePortfolio(normalizePortfolio(['stocks' => [['ticker' => 'MU', 'list' => 'owned']]]));
        $user->recordFailedLogin();

        $this->artisan('stock-panel:set-password')
            ->expectsQuestion('New password', 'a new password')
            ->expectsQuestion('The same password again', 'a new password')
            ->expectsOutput('The new password is saved. Log in with it in the app.')
            ->assertSuccessful();

        $user->refresh();
        $this->assertTrue(Hash::check('a new password', $user->password));
        $this->assertSame(0, $user->failed_logins);
        $this->assertSame([['ticker' => 'MU', 'list' => 'owned']], $user->portfolio()['stocks']);
    }

    public function testRefusesAShortOrMistypedPassword(): void
    {
        $user = User::factory()->create(['password' => 'the-old-one']);

        $this->artisan('stock-panel:set-password')
            ->expectsQuestion('New password', 'short')
            ->assertFailed();
        $this->artisan('stock-panel:set-password')
            ->expectsQuestion('New password', 'a new password')
            ->expectsQuestion('The same password again', 'a new passwrod')
            ->assertFailed();

        $this->assertTrue(Hash::check('the-old-one', $user->fresh()->password));
    }

    public function testSetsTheFirstPasswordToo(): void
    {
        $this->artisan('stock-panel:set-password')
            ->expectsQuestion('New password', 'a new password')
            ->expectsQuestion('The same password again', 'a new password')
            ->assertSuccessful();

        $this->assertTrue(Hash::check('a new password', User::query()->sole()->password));
    }
}
