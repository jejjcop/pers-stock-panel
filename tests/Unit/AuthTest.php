<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Choosing and checking the password, and pausing logins after wrong ones.
 */
final class AuthTest extends TestCase
{
    private string $path;

    protected function setUp(): void
    {
        $this->path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'stock-panel-auth-test-' . bin2hex(random_bytes(6)) . '.json';
    }

    protected function tearDown(): void
    {
        if (is_file($this->path)) {
            unlink($this->path);
        }
        $_SERVER = array_diff_key($_SERVER, array_flip(['REMOTE_ADDR', 'HTTP_ORIGIN', 'HTTP_HOST', 'HTTPS', 'HTTP_X_FORWARDED_PROTO']));
    }

    public function testAPasswordMustBeLongEnoughAndTypedTheSameTwice(): void
    {
        self::assertSame('The password must be at least 8 characters long.', setPassword($this->path, 'short', 'short'));
        self::assertSame('The two passwords are not the same.', setPassword($this->path, 'long enough', 'long enuogh'));
        self::assertFalse(isPasswordSet($this->path));

        self::assertNull(setPassword($this->path, 'long enough', 'long enough'));
        self::assertTrue(isPasswordSet($this->path));
    }

    public function testOnlyAHashOfThePasswordIsStored(): void
    {
        setPassword($this->path, 'long enough', 'long enough');

        $stored = (string) file_get_contents($this->path);

        self::assertStringNotContainsString('long enough', $stored);
        self::assertTrue(password_verify('long enough', loadAuth($this->path)['passwordHash']));
    }

    public function testTheRightPasswordLogsInAndAWrongOneDoesNot(): void
    {
        setPassword($this->path, 'long enough', 'long enough');

        self::assertSame(['ok' => false, 'retryAfter' => 0], attemptLogin($this->path, 'wrong', 1000));
        self::assertSame(['ok' => true, 'retryAfter' => 0], attemptLogin($this->path, 'long enough', 1000));
        self::assertSame(0, loadAuth($this->path)['failedAttempts']);
    }

    public function testNoPasswordMeansNoLogin(): void
    {
        self::assertSame(['ok' => false, 'retryAfter' => 0], attemptLogin($this->path, '', 1000));
    }

    public function testLoggingInPausesAfterFiveWrongPasswords(): void
    {
        setPassword($this->path, 'long enough', 'long enough');

        foreach ([1, 2, 3, 4] as $attempt) {
            self::assertSame(0, attemptLogin($this->path, "wrong $attempt", 1000)['retryAfter']);
        }
        self::assertSame(30, attemptLogin($this->path, 'wrong 5', 1000)['retryAfter']);

        // During the pause even the right password is not checked.
        self::assertSame(['ok' => false, 'retryAfter' => 20], attemptLogin($this->path, 'long enough', 1010));
        // After it, the right password works and the count starts over.
        self::assertSame(['ok' => true, 'retryAfter' => 0], attemptLogin($this->path, 'long enough', 1031));
        self::assertSame(0, loadAuth($this->path)['failedAttempts']);
    }

    public function testThePauseDoublesUpToFifteenMinutes(): void
    {
        self::assertSame([0, 30, 60, 120, 900, 900], array_map('lockSeconds', [4, 5, 6, 7, 10, 20]));
    }

    public function testOnlyThisComputerCountsAsLocal(): void
    {
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
        self::assertTrue(isLocalRequest());
        $_SERVER['REMOTE_ADDR'] = '::1';
        self::assertTrue(isLocalRequest());
        $_SERVER['REMOTE_ADDR'] = '192.168.1.20';
        self::assertFalse(isLocalRequest());
    }

    public function testRequestsFromOtherSitesAreNotSameOrigin(): void
    {
        $_SERVER['HTTP_HOST'] = '127.0.0.1:8080';
        self::assertTrue(isSameOriginRequest());
        $_SERVER['HTTP_ORIGIN'] = 'http://127.0.0.1:8080';
        self::assertTrue(isSameOriginRequest());
        $_SERVER['HTTP_ORIGIN'] = 'https://evil.example';
        self::assertFalse(isSameOriginRequest());
    }

    public function testHttpsIsRecognisedDirectlyAndBehindAProxy(): void
    {
        self::assertFalse(isHttps());
        $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
        self::assertTrue(isHttps());
        unset($_SERVER['HTTP_X_FORWARDED_PROTO']);
        $_SERVER['HTTPS'] = 'on';
        self::assertTrue(isHttps());
    }
}
