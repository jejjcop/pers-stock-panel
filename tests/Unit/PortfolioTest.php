<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Checking, saving and loading data/portfolio.json.
 */
final class PortfolioTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'stock-panel-test-' . bin2hex(random_bytes(6));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->directory . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
            unlink($file);
        }
        if (is_dir($this->directory)) {
            rmdir($this->directory);
        }
    }

    private function path(): string
    {
        return $this->directory . DIRECTORY_SEPARATOR . 'portfolio.json';
    }

    public function testKeepsValidStocksAndHoldings(): void
    {
        $portfolio = normalizePortfolio([
            'stocks' => [['ticker' => 'mu ', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ]);

        self::assertSame([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19.0, 'cost' => 989.5]],
        ], $portfolio);
    }

    public function testDropsDuplicateStocks(): void
    {
        $portfolio = normalizePortfolio([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'MU', 'list' => 'monitor']],
        ]);

        self::assertSame([['ticker' => 'MU', 'list' => 'owned']], $portfolio['stocks']);
        self::assertSame([], $portfolio['holdings']);
    }

    public function testRejectsAnInvalidStockList(): void
    {
        self::assertNull(normalizePortfolio(null));
        self::assertNull(normalizePortfolio(['stocks' => 'MU']));
        self::assertNull(normalizePortfolio(['stocks' => [['ticker' => 'BAD TICKER', 'list' => 'owned']]]));
        self::assertNull(normalizePortfolio(['stocks' => [['ticker' => 'MU', 'list' => 'sold']]]));
        self::assertNull(normalizePortfolio(['stocks' => [], 'holdings' => 'none']));
    }

    public function testRejectsMoreThanTheMaximumNumberOfStocks(): void
    {
        $stocks = array_map(static fn (int $n): array => ['ticker' => "T{$n}", 'list' => 'owned'], range(1, PORTFOLIO_MAX_STOCKS + 1));

        self::assertNull(normalizePortfolio(['stocks' => $stocks]));
        self::assertNotNull(normalizePortfolio(['stocks' => array_slice($stocks, 0, PORTFOLIO_MAX_STOCKS)]));
    }

    public function testDropsHoldingsThatCannotBeUsed(): void
    {
        $portfolio = normalizePortfolio([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => '123', 'list' => 'owned']],
            'holdings' => [
                'MU' => ['shares' => -5, 'cost' => '989.5'],
                'AAPL' => ['shares' => 10, 'cost' => 150],
                123 => ['shares' => 2, 'cost' => null],
            ],
        ]);

        // MU has no usable number left, AAPL is not in the list, and the
        // all-digit ticker 123 arrives as an integer key from json_decode.
        self::assertSame(['123' => ['shares' => 2.0, 'cost' => null]], $portfolio['holdings']);
    }

    public function testSavedPortfolioLoadsBackUnchanged(): void
    {
        $portfolio = normalizePortfolio([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned']],
            'holdings' => ['MU' => ['shares' => 19, 'cost' => 989.5]],
        ]);

        self::assertTrue(savePortfolio($this->path(), $portfolio));
        self::assertSame($portfolio, loadPortfolio($this->path()));
    }

    public function testEmptyHoldingsAreSavedAsAJsonObject(): void
    {
        savePortfolio($this->path(), defaultPortfolio());

        $saved = json_decode((string) file_get_contents($this->path()));

        self::assertInstanceOf(stdClass::class, $saved->holdings);
        self::assertSame(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'], array_column(loadPortfolio($this->path())['stocks'], 'ticker'));
    }

    public function testSavingKeepsThePreviousVersionAsABackup(): void
    {
        $first = normalizePortfolio(['stocks' => [['ticker' => 'MU', 'list' => 'owned']]]);
        $second = normalizePortfolio(['stocks' => [['ticker' => 'NVDA', 'list' => 'owned']]]);

        savePortfolio($this->path(), $first);
        savePortfolio($this->path(), $second);

        self::assertSame($second, loadPortfolio($this->path()));
        self::assertSame($first, loadPortfolio($this->path() . '.bak'));
    }

    public function testMissingOrDamagedFilesLoadAsNull(): void
    {
        self::assertNull(loadPortfolio($this->path()));

        mkdir($this->directory);
        file_put_contents($this->path(), '{"stocks": [');

        self::assertNull(loadPortfolio($this->path()));
    }
}
