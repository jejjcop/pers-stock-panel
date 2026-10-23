<?php

namespace Tests\Feature;

use Tests\TestCase;
use Tests\UsesTemporaryDataFolder;

/**
 * Logging in and out, and choosing the first password.
 */
class LoginTest extends TestCase
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

    public function testTheRightPasswordLogsIn(): void
    {
        $this->choosePassword('the-password');

        $this->post('/login', ['password' => 'the-password'])
            ->assertRedirect('/')
            ->assertSessionHas('logged_in', true);
    }

    public function testAWrongPasswordGoesBackWithAMessage(): void
    {
        $this->choosePassword('the-password');

        $this->from('/login')->post('/login', ['password' => 'not-it'])
            ->assertRedirect('/login')
            ->assertSessionHasErrors(['password' => 'Wrong password.'])
            ->assertSessionMissing('logged_in');
        $this->assertSame(1, loadAuth(authPath())['failedAttempts']);
    }

    public function testShowsTheLoginForm(): void
    {
        $this->choosePassword('the-password');

        $this->get('/login')->assertOk()->assertSee('Log in')->assertDontSee('Choose a password');
        $this->get('/login?expired=1')->assertSee('You have been logged out. Log in again to continue.');
    }

    public function testAskForTheFirstPasswordOnlyWithoutOne(): void
    {
        $this->get('/login')->assertSee('Choose a password');
    }

    public function testChoosesTheFirstPassword(): void
    {
        $this->from('/login')->post('/login', ['password' => 'short', 'password_confirmation' => 'short'])
            ->assertSessionHasErrors(['password' => 'The password must be at least 8 characters long.']);
        $this->from('/login')->post('/login', ['password' => 'my new password', 'password_confirmation' => 'my new passwrod'])
            ->assertSessionHasErrors(['password' => 'The two passwords are not the same.']);
        $this->assertFalse(isPasswordSet(authPath()));

        $this->post('/login', ['password' => 'my new password', 'password_confirmation' => 'my new password'])
            ->assertRedirect('/')
            ->assertSessionHas('logged_in', true);
        $this->assertTrue(password_verify('my new password', loadAuth(authPath())['passwordHash']));
    }

    public function testOnlyThisComputerMayChooseTheFirstPassword(): void
    {
        $fromAnotherComputer = ['REMOTE_ADDR' => '192.168.1.20'];

        $this->withServerVariables($fromAnotherComputer)->get('/login')
            ->assertSee('No password has been chosen yet.');
        $this->withServerVariables($fromAnotherComputer)->from('/login')
            ->post('/login', ['password' => 'my new password', 'password_confirmation' => 'my new password'])
            ->assertSessionHasErrors(['password' => 'The password can only be chosen on the computer the app runs on.']);
        $this->assertFalse(isPasswordSet(authPath()));
    }

    public function testLoggingOutEndsTheLogin(): void
    {
        $this->withSession(['logged_in' => true])->post('/logout')
            ->assertRedirect('/login')
            ->assertSessionMissing('logged_in');
    }

    public function testTheLoginPageSendsYouOnWhenLoggedIn(): void
    {
        $this->withSession(['logged_in' => true])->get('/login')->assertRedirect('/');
    }
}
