<?php

declare(strict_types=1);

// Reading auth.json, where older versions kept the password hash and the
// count of wrong passwords. Now only read once, to copy it into the database
// (php artisan stock-panel:import-json); the login itself uses the User model.

require_once __DIR__ . '/portfolio.php';

function authPath(): string
{
    return dataDirectory() . DIRECTORY_SEPARATOR . 'auth.json';
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
