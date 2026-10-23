<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Reading Yahoo's chart responses, including the broken ones.
 */
final class ChartResponseTest extends TestCase
{
    public function testReadsTheFirstChartResult(): void
    {
        $body = json_encode(['chart' => ['result' => [[
            'meta' => ['symbol' => 'AAPL', 'regularMarketPrice' => 333.63],
            'timestamp' => [1, 2],
            'indicators' => ['quote' => [['close' => [10.5, null]]]],
        ]]]]);

        $result = chartResult($body);

        self::assertSame('AAPL', $result['meta']['symbol']);
        self::assertSame([[1, 2], [10.5, null]], chartSeries($result));
    }

    public function testRejectsResponsesWithoutUsableData(): void
    {
        self::assertNull(chartResult('not json'));
        self::assertNull(chartResult('{"chart":{"result":null,"error":{"code":"Not Found"}}}'));
        self::assertNull(chartResult('{"chart":{"result":[{"timestamp":[1]}]}}'));
    }

    public function testSeriesIsEmptyWhenThereAreNoBars(): void
    {
        self::assertSame([[], []], chartSeries(['meta' => []]));
    }
}
