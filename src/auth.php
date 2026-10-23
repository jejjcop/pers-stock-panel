<?php

declare(strict_types=1);

// The password for the single user of the app. The password hash and the
// count of failed attempts live in auth.json next to portfolio.json, outside
// the web root and outside Git. Whether a browser is logged in is kept in
// Laravel's session (app/Http/Controllers/LoginController.php).

require_once __DIR__ . '/portfolio.php';

const PASSWORD_MIN_LENGTH = 8;
// Failed attempts allowed before logging in is paused for a while.
const LOGIN_FREE_ATTEMPTS = 5;
const LOGIN_FIRST_LOCK_SECONDS = 30;
const LOGIN_MAX_LOCK_SECONDS = 900;

function authPath(): string
{
    return dirname(portfolioPath()) . DIRECTORY_SEPARATOR . 'auth.json';
}

/**
 * @return array{passwordHash: ?string, failedAttempts: int, lockedUntil: int}
 */
function loadAuth(string $path): array
{
    $data = is_file($path) ? json_decode((string) @file_get_contents($path), true) : null;
    $data = is_array($data) ? $data : [];

    return [
        'passwordHash' => is_string($data['passwordHash'] ?? null) ? $data['passwordHash'] : null,
        'failedAttempts' => is_int($data['failedAttempts'] ?? null) ? $data['failedAttempts'] : 0,
        'lockedUntil' => is_int($data['lockedUntil'] ?? null) ? $data['lockedUntil'] : 0,
    ];
}

function saveAuth(string $path, array $auth): bool
{
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
        return false;
    }

    $temporaryPath = @tempnam($directory, 'auth');
    if ($temporaryPath === false) {
        return false;
    }
    if (@file_put_contents($temporaryPath, json_encode($auth, JSON_PRETTY_PRINT) . "\n", LOCK_EX) === false
        || !@rename($temporaryPath, $path)) {
        @unlink($temporaryPath);
        return false;
    }

    return true;
}

function isPasswordSet(string $path): bool
{
    return loadAuth($path)['passwordHash'] !== null;
}

/**
 * Sets a new password. Returns an error message, or null when it was saved.
 */
function setPassword(string $path, string $password, string $confirmation): ?string
{
    if (mb_strlen($password) < PASSWORD_MIN_LENGTH) {
        return 'The password must be at least ' . PASSWORD_MIN_LENGTH . ' characters long.';
    }
    if ($password !== $confirmation) {
        return 'The two passwords are not the same.';
    }

    $auth = ['passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'failedAttempts' => 0, 'lockedUntil' => 0];

    return saveAuth($path, $auth) ? null : 'The password could not be saved.';
}

/**
 * How long logging in is paused after this many failed attempts in a row:
 * nothing for the first few, then 30 seconds, doubling up to 15 minutes.
 */
function lockSeconds(int $failedAttempts): int
{
    if ($failedAttempts < LOGIN_FREE_ATTEMPTS) {
        return 0;
    }

    return min(LOGIN_MAX_LOCK_SECONDS, LOGIN_FIRST_LOCK_SECONDS * 2 ** ($failedAttempts - LOGIN_FREE_ATTEMPTS));
}

/**
 * Checks a password. While logging in is paused, no password is checked.
 *
 * @return array{ok: bool, retryAfter: int} retryAfter is the seconds left
 *     before the next attempt is allowed (0 when one is allowed now).
 */
function attemptLogin(string $path, string $password, int $now): array
{
    $auth = loadAuth($path);
    if ($auth['passwordHash'] === null) {
        return ['ok' => false, 'retryAfter' => 0];
    }
    if ($auth['lockedUntil'] > $now) {
        return ['ok' => false, 'retryAfter' => $auth['lockedUntil'] - $now];
    }

    if (password_verify($password, $auth['passwordHash'])) {
        if (password_needs_rehash($auth['passwordHash'], PASSWORD_DEFAULT)) {
            $auth['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
        }
        $auth['failedAttempts'] = 0;
        $auth['lockedUntil'] = 0;
        saveAuth($path, $auth);
        return ['ok' => true, 'retryAfter' => 0];
    }

    $auth['failedAttempts'] += 1;
    $auth['lockedUntil'] = $now + lockSeconds($auth['failedAttempts']);
    saveAuth($path, $auth);

    return ['ok' => false, 'retryAfter' => $auth['lockedUntil'] - $now];
}
