<?php

declare(strict_types=1);

namespace StockPanel;

final class StockPanel
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public static function watchlist(): array
    {
        return [
            ['ticker' => 'AAPL', 'name' => 'Apple Inc.'],
            ['ticker' => 'MSFT', 'name' => 'Microsoft Corp.'],
            ['ticker' => 'NVDA', 'name' => 'NVIDIA Corp.'],
            ['ticker' => 'AMZN', 'name' => 'Amazon.com Inc.'],
            ['ticker' => 'META', 'name' => 'Meta Platforms'],
        ];
    }
}
