<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The market status badge and the refresh timing that depends on it.
 */
final class MarketStatusTest extends TestCase
{
    /**
     * Monday 2026-10-05's sessions in the flat shape Yahoo uses in
     * currentTradingPeriod.
     */
    private static function mondaySessions(): array
    {
        $session = static fn (string $start, string $end): array => [
            'start' => nyTime("2026-10-05 {$start}"),
            'end' => nyTime("2026-10-05 {$end}"),
        ];

        return [
            'pre' => $session('04:00', '09:30'),
            'regular' => $session('09:30', '16:00'),
            'post' => $session('16:00', '20:00'),
        ];
    }

    /**
     * @return array<string, array{string, string, string, string, string}>
     */
    public static function clockTimes(): array
    {
        // now => session, badge label, badge time, next refresh boundary
        return [
            'before pre-market' => ['2026-10-05 03:00', 'closed', 'Opens', '2026-10-05 09:30', '2026-10-05 04:00'],
            'pre-market' => ['2026-10-05 07:00', 'preMarket', 'Opens', '2026-10-05 09:30', '2026-10-05 09:30'],
            'regular hours' => ['2026-10-05 12:00', 'open', 'Closes', '2026-10-05 16:00', '2026-10-05 16:00'],
            'after-hours' => ['2026-10-05 17:00', 'afterHours', 'After-hours ends', '2026-10-05 20:00', '2026-10-05 20:00'],
            'weekday night' => ['2026-10-05 21:00', 'closed', 'Opens', '2026-10-06 09:30', '2026-10-06 04:00'],
            'Friday night' => ['2026-10-09 21:00', 'closed', 'Opens', '2026-10-12 09:30', '2026-10-12 04:00'],
            'Saturday' => ['2026-10-10 12:00', 'closed', 'Opens', '2026-10-12 09:30', '2026-10-12 04:00'],
        ];
    }

    #[DataProvider('clockTimes')]
    public function testStatusAndNextChange(
        string $now,
        string $session,
        string $label,
        string $nextChange,
        string $nextSessionChange
    ): void {
        $status = marketStatus(self::mondaySessions(), 'America/New_York', 'NasdaqGS', nyTime($now));

        self::assertSame([
            'session' => $session,
            'name' => 'US market',
            'timezone' => 'America/New_York',
            'nextChangeLabel' => $label,
            'nextChangeAt' => nyTime($nextChange),
            'nextSessionChangeAt' => nyTime($nextSessionChange),
        ], $status);
    }

    public function testNextOpenKeepsTheLocalOpeningTimeAcrossTheDaylightSavingChange(): void
    {
        // US clocks go back on Sunday 2026-11-01, so Monday's 09:30 open is an
        // hour later in UTC than Friday's.
        $fridayOpen = nyTime('2026-10-30 09:30');

        $nextOpen = nextRegularOpen($fridayOpen, 'America/New_York', nyTime('2026-10-30 21:00'));

        self::assertSame(nyTime('2026-11-02 09:30'), $nextOpen);
        self::assertSame('14:30', gmdate('H:i', $nextOpen));
    }

    public function testOtherExchangesAreNamedAfterTheExchange(): void
    {
        $status = marketStatus(self::mondaySessions(), 'Europe/Berlin', 'XETRA', nyTime('2026-10-05 12:00'));

        self::assertSame('XETRA market', $status['name']);
    }

    public function testStatusIsUnknownWithoutARegularSession(): void
    {
        self::assertNull(marketStatus([], 'America/New_York', 'NasdaqGS', nyTime('2026-10-05 12:00')));
    }

    public function testSessionBoundsRequireAStartAndAnEnd(): void
    {
        self::assertSame([10, 20], sessionBounds(['start' => 10, 'end' => '20']));
        self::assertNull(sessionBounds(['start' => 10]));
        self::assertNull(sessionBounds(null));
    }
}
