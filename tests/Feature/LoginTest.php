<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Logging in and out, and choosing the first password.
 */
class LoginTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        return User::factory()->create(['password' => 'the-password']);
    }

    public function testTheRightPasswordLogsIn(): void
    {
        $user = $this->owner();

        $this->post('/login', ['password' => 'the-password'])->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
    }

    public function testAWrongPasswordGoesBackWithAMessage(): void
    {
        $user = $this->owner();

        $this->from('/login')->post('/login', ['password' => 'not-it'])
            ->assertRedirect('/login')
            ->assertSessionHasErrors(['password' => 'Wrong password.']);

        $this->assertGuest();
        $this->assertSame(1, $user->fresh()->failed_logins);
    }

    public function testLoggingInPausesAfterFiveWrongPasswords(): void
    {
        $user = $this->owner();

        for ($attempt = 1; $attempt <= 4; $attempt++) {
            $this->from('/login')->post('/login', ['password' => "wrong-{$attempt}"])
                ->assertSessionHasErrors(['password' => 'Wrong password.']);
        }
        $this->from('/login')->post('/login', ['password' => 'wrong-5'])
            ->assertSessionHasErrors(['password' => 'Wrong password, or too many attempts. Try again in 30 seconds.']);

        // Even the right password is refused while paused...
        $this->from('/login')->post('/login', ['password' => 'the-password'])->assertSessionHasErrors('password');
        $this->assertGuest();

        // ...and accepted once the pause is over, which starts the count again.
        $this->travel(31)->seconds();
        $this->post('/login', ['password' => 'the-password'])->assertRedirect('/');
        $this->assertAuthenticated();
        $this->assertSame(0, $user->fresh()->failed_logins);
    }

    public function testShowsTheLoginForm(): void
    {
        $this->owner();

        $this->get('/login')->assertOk()->assertSee('Log in')->assertDontSee('Choose a password');
        $this->get('/login?expired=1')->assertSee('You have been logged out. Log in again to continue.');
    }

    public function testAsksForTheFirstPasswordWithoutOne(): void
    {
        $this->get('/login')->assertSee('Choose a password');
    }

    public function testChoosesTheFirstPassword(): void
    {
        $this->from('/login')->post('/login', ['password' => 'short', 'password_confirmation' => 'short'])
            ->assertSessionHasErrors(['password' => 'The password must be at least 8 characters long.']);
        $this->from('/login')->post('/login', ['password' => 'my new password', 'password_confirmation' => 'my new passwrod'])
            ->assertSessionHasErrors(['password' => 'The two passwords are not the same.']);
        $this->assertDatabaseCount('users', 0);

        $this->post('/login', ['password' => 'my new password', 'password_confirmation' => 'my new password'])
            ->assertRedirect('/');

        $this->assertAuthenticated();
        // Only a hash of the password is stored, never the password itself.
        $stored = User::query()->sole()->getRawOriginal('password');
        $this->assertNotSame('my new password', $stored);
        $this->assertTrue(Hash::check('my new password', $stored));
    }

    public function testOnlyThisComputerMayChooseTheFirstPassword(): void
    {
        $fromAnotherComputer = ['REMOTE_ADDR' => '192.168.1.20'];

        $this->withServerVariables($fromAnotherComputer)->get('/login')
            ->assertSee('No password has been chosen yet.');
        $this->withServerVariables($fromAnotherComputer)->from('/login')
            ->post('/login', ['password' => 'my new password', 'password_confirmation' => 'my new password'])
            ->assertSessionHasErrors(['password' => 'The password can only be chosen on the computer the app runs on.']);
        $this->assertDatabaseCount('users', 0);
    }

    public function testLoggingOutEndsTheLogin(): void
    {
        $this->actingAs($this->owner())->post('/logout')->assertRedirect('/login');

        $this->assertGuest();
    }

    public function testTheLoginPageSendsYouOnWhenLoggedIn(): void
    {
        $this->actingAs($this->owner())->get('/login')->assertRedirect('/');
    }
}
