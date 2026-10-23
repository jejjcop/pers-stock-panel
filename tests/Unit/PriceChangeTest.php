<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * The previous close and the week/month changes, calculated from daily bars.
 * Yahoo stamps each daily bar with the session's opening time.
 */
final class PriceChangeTest extends TestCase
{
    public function testPreviousCloseIsTheLastTradingDayBeforeTheMarketDate(): void
    {
        // Thu, Fri, then Mon (today). The weekend has no bars.
        $timestamps = [nyTime('2026-10-01 09:30'), nyTime('2026-10-02 09:30'), nyTime('2026-10-05 09:30')];
        $closes = [100.0, 101.5, 103.0];

        $previousClose = previousTradingClose($timestamps, $closes, nyTime('2026-10-05 12:00'), 'America/New_York');

        self::assertSame(101.5, $previousClose);
    }

    public function testPreviousCloseUsesTheExchangeTimezoneForTheMarketDate(): void
    {
        // 21:00 in New York is already the next day in UTC; today's bar must
        // still count as "today" and not as the previous close.
        $timestamps = [nyTime('2026-10-02 09:30'), nyTime('2026-10-05 09:30')];
        $closes = [101.5, 103.0];

        $previousClose = previousTradingClose($timestamps, $closes, nyTime('2026-10-05 21:00'), 'America/New_York');

        self::assertSame(101.5, $previousClose);
    }

    public function testPreviousCloseSkipsBarsWithoutAClose(): void
    {
        $timestamps = [nyTime('2026-10-01 09:30'), nyTime('2026-10-02 09:30'), nyTime('2026-10-05 09:30')];
        $closes = [100.0, null, 103.0];

        $previousClose = previousTradingClose($timestamps, $closes, nyTime('2026-10-05 12:00'), 'America/New_York');

        self::assertSame(100.0, $previousClose);
    }

    public function testPreviousCloseIsNullWithoutEarlierBars(): void
    {
        $previousClose = previousTradingClose([nyTime('2026-10-05 09:30')], [103.0], nyTime('2026-10-05 12:00'), 'America/New_York');

        self::assertNull($previousClose);
    }

    public function testWeekChangeComparesWithTheLatestCloseAtLeastSevenDaysEarlier(): void
    {
        $timestamps = [
            nyTime('2026-09-25 09:30'),
            nyTime('2026-09-28 09:30'),
            nyTime('2026-09-29 09:30'),
            nyTime('2026-10-05 09:30'),
        ];
        $closes = [90.0, 100.0, 105.0, 108.0];

        // Seven days before Mon 10-05 12:00 is Mon 09-28 12:00, so the 09-28
        // bar is the baseline and the later 09-29 bar is too recent.
        $change = periodChangePct($timestamps, $closes, 110.0, nyTime('2026-10-05 12:00'), 7);

        self::assertEqualsWithDelta(10.0, $change, 0.000001);
    }

    public function testPeriodChangeIsNullWithoutABaseline(): void
    {
        $change = periodChangePct([nyTime('2026-10-05 09:30')], [108.0], 110.0, nyTime('2026-10-05 12:00'), 7);

        self::assertNull($change);
    }

    public function testPeriodChangeIsNullWhenTheBaselineIsZero(): void
    {
        $change = periodChangePct([nyTime('2026-09-01 09:30')], [0.0], 110.0, nyTime('2026-10-05 12:00'), 30);

        self::assertNull($change);
    }
}
