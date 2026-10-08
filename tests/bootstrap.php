<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';
require __DIR__ . '/../src/quote_functions.php';

/**
 * Converts a New York wall-clock time such as '2026-10-05 09:30' to a Unix
 * timestamp, so tests can be written in exchange time.
 */
function nyTime(string $dateTime): int
{
    return (new DateTimeImmutable($dateTime, new DateTimeZone('America/New_York')))->getTimestamp();
}
