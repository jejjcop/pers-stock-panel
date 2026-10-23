<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Exchange rates to kronor, and the price history behind the large chart.
 */
final class FxAndHistoryTest extends TestCase
{
    public function testOnlyCurrenciesOtherThanKronorNeedARate(): void
    {
        $quotes = [
            'MU' => ['currency' => 'USD'],
            'AAPL' => ['currency' => 'USD'],
            'VOLV-B.ST' => ['currency' => 'SEK'],
            'SAP.DE' => ['currency' => 'EUR'],
            // Yahoo quotes London stocks in pence; there is no pence-to-kronor rate.
            'VOD.L' => ['currency' => 'GBp'],
            'BROKEN' => [],
        ];

        self::assertSame(['USD', 'EUR'], currenciesToConvert($quotes));
    }

    public function testRateSymbolAndValue(): void
    {
        self::assertSame('USDSEK=X', fxSymbol('USD'));
        self::assertSame(9.9701, fxRate(['meta' => ['regularMarketPrice' => 9.9701]]));
        self::assertNull(fxRate(['meta' => ['regularMarketPrice' => 0]]));
        self::assertNull(fxRate(['meta' => []]));
    }

    public function testHistoryKeepsBarsWithAClose(): void
    {
        $result = [
            'meta' => [],
            'timestamp' => [100, 200, 300],
            'indicators' => ['quote' => [['close' => [10.123456, null, 12]]]],
        ];

        self::assertSame([[100, 10.1235], [300, 12.0]], historyPoints($result));
    }

    public function testEveryChartPeriodHasAYahooRangeAndBarSize(): void
    {
        self::assertSame(['1d', '1w', '1m', '1y', '5y'], array_keys(HISTORY_RANGES));
        foreach (HISTORY_RANGES as $settings) {
            self::assertMatchesRegularExpression('/^\d+(d|mo|y)$/', $settings['range']);
            self::assertMatchesRegularExpression('/^\d+(m|d|wk)$/', $settings['interval']);
            self::assertGreaterThan(0, $settings['cacheSeconds']);
        }
    }
}
