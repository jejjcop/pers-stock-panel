<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Pre-market / after-hours prices and the chart points, calculated from
 * 1-minute bars.
 */
final class IntradayTest extends TestCase
{
    /**
     * Trading periods in the nested shape Yahoo uses in tradingPeriods.
     */
    private static function periods(): array
    {
        $session = static fn (string $start, string $end): array => [[['start' => nyTime($start), 'end' => nyTime($end)]]];

        return [
            'pre' => $session('2026-10-05 04:00', '2026-10-05 09:30'),
            'regular' => $session('2026-10-05 09:30', '2026-10-05 16:00'),
            'post' => $session('2026-10-05 16:00', '2026-10-05 20:00'),
        ];
    }

    public function testChartKeepsOnlyRegularHoursAndTheLastCloseOfEachFiveMinutes(): void
    {
        $times = ['09:29', '09:30', '09:31', '09:34', '09:35', '09:39', '09:40', '15:59', '16:00'];
        $timestamps = array_map(static fn (string $time): int => nyTime("2026-10-05 {$time}"), $times);
        $closes = [99.0, 100.0, 100.5, 101.0, 101.5, 102.0, 102.5, 110.0, 111.0];

        $points = intradayPoints($timestamps, $closes, self::periods()['regular']);

        self::assertSame([
            [nyTime('2026-10-05 09:34'), 101.0],
            [nyTime('2026-10-05 09:39'), 102.0],
            [nyTime('2026-10-05 09:40'), 102.5],
            [nyTime('2026-10-05 15:59'), 110.0],
        ], $points);
    }

    public function testChartSkipsMissingClosesAndIsEmptyWithoutARegularSession(): void
    {
        $timestamps = [nyTime('2026-10-05 09:30'), nyTime('2026-10-05 09:31')];

        self::assertSame([[nyTime('2026-10-05 09:30'), 100.0]], intradayPoints($timestamps, [100.0, null], self::periods()['regular']));
        self::assertSame([], intradayPoints($timestamps, [100.0, 100.5], null));
    }

    public function testLatestSessionQuoteIsTheLastCloseInsideTheSession(): void
    {
        $timestamps = [nyTime('2026-10-05 08:00'), nyTime('2026-10-05 09:29'), nyTime('2026-10-05 09:30')];
        $closes = [98.0, 99.0, 100.0];

        $quote = latestSessionQuote($timestamps, $closes, self::periods()['pre']);

        self::assertSame(['price' => 99.0, 'time' => nyTime('2026-10-05 09:29')], $quote);
    }

    public function testLatestSessionQuoteIsNullWhenTheSessionHasNoTrades(): void
    {
        $quote = latestSessionQuote([nyTime('2026-10-05 10:00')], [100.0], self::periods()['post']);

        self::assertNull($quote);
    }

    public function testActiveExtendedSessionFollowsTheClock(): void
    {
        $periods = self::periods();

        self::assertSame('preMarket', activeExtendedSession($periods, nyTime('2026-10-05 04:00')));
        self::assertNull(activeExtendedSession($periods, nyTime('2026-10-05 09:30')));
        self::assertSame('afterHours', activeExtendedSession($periods, nyTime('2026-10-05 19:59')));
        self::assertNull(activeExtendedSession($periods, nyTime('2026-10-05 20:00')));
    }
}
