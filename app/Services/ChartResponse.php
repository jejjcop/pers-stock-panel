<?php

namespace App\Services;

/**
 * Yahoo Finance's answer to one chart request: the chart data, or why there
 * is none.
 */
final readonly class ChartResponse
{
    public function __construct(
        // The chart data (Yahoo's chart.result[0]), or null when unavailable.
        public ?array $result,
        // Why there is no chart data, in words the page can show.
        public ?string $error = null,
        // Whether it came from the cache rather than being downloaded now.
        public bool $fromCache = false,
    ) {
    }

    public static function failed(string $error): self
    {
        return new self(null, $error);
    }
}
