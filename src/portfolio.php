<?php

declare(strict_types=1);

// Reading, checking and writing data/portfolio.json, the file that holds the
// user's stock lists and holdings.

require_once __DIR__ . '/StockPanel.php';

use StockPanel\StockPanel;

const TICKER_PATTERN = '/^[A-Z0-9][A-Z0-9.-]{0,9}$/';
const PORTFOLIO_LISTS = ['owned', 'monitor'];
const PORTFOLIO_MAX_STOCKS = 25;

function portfolioPath(): string
{
    // The browser tests point this at a temporary folder so they never touch
    // the real data file.
    $directory = getenv('STOCK_PANEL_DATA_DIR');
    if (!is_string($directory) || $directory === '') {
        $directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
    }

    return $directory . DIRECTORY_SEPARATOR . 'portfolio.json';
}

/**
 * The starting portfolio before anything has been saved: the built-in stocks
 * in My current stocks, with no holdings.
 */
function defaultPortfolio(): array
{
    return [
        'stocks' => array_map(
            static fn (array $stock): array => ['ticker' => (string) $stock['ticker'], 'list' => 'owned'],
            StockPanel::watchlist()
        ),
        'holdings' => [],
    ];
}

function portfolioAmount(mixed $value): ?float
{
    if (!is_int($value) && !is_float($value)) {
        return null;
    }

    return is_finite((float) $value) && $value >= 0 ? (float) $value : null;
}

/**
 * Checks portfolio data and returns it in a clean shape, or null when the
 * stock list is not valid. Holdings for stocks that are not in the list, and
 * shares or costs that are not non-negative numbers, are dropped.
 *
 * @return array{stocks: array<int, array{ticker: string, list: string}>, holdings: array<string, array{shares: ?float, cost: ?float}>}|null
 */
function normalizePortfolio(mixed $data): ?array
{
    if (!is_array($data) || !is_array($data['stocks'] ?? null) || !is_array($data['holdings'] ?? [])) {
        return null;
    }

    $stocks = [];
    $tickers = [];
    foreach ($data['stocks'] as $stock) {
        $ticker = is_array($stock) && is_string($stock['ticker'] ?? null) ? strtoupper(trim($stock['ticker'])) : '';
        $list = is_array($stock) ? ($stock['list'] ?? null) : null;
        if (preg_match(TICKER_PATTERN, $ticker) !== 1 || !in_array($list, PORTFOLIO_LISTS, true)) {
            return null;
        }
        if (isset($tickers[$ticker])) {
            continue;
        }

        $tickers[$ticker] = true;
        $stocks[] = ['ticker' => $ticker, 'list' => $list];
    }

    if (count($stocks) > PORTFOLIO_MAX_STOCKS) {
        return null;
    }

    $holdings = [];
    foreach ($data['holdings'] ?? [] as $ticker => $holding) {
        // json_decode turns an all-digit key such as "123" into an integer.
        $ticker = (string) $ticker;
        if (!isset($tickers[$ticker]) || !is_array($holding)) {
            continue;
        }

        $shares = portfolioAmount($holding['shares'] ?? null);
        $cost = portfolioAmount($holding['cost'] ?? null);
        if ($shares !== null || $cost !== null) {
            $holdings[$ticker] = ['shares' => $shares, 'cost' => $cost];
        }
    }

    return ['stocks' => $stocks, 'holdings' => $holdings];
}

/**
 * Returns the saved portfolio, or null when the file does not exist or cannot
 * be read as a valid portfolio.
 */
function loadPortfolio(string $path): ?array
{
    if (!is_file($path)) {
        return null;
    }

    $contents = @file_get_contents($path);
    if ($contents === false) {
        return null;
    }

    try {
        $data = json_decode($contents, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }

    return normalizePortfolio($data);
}

/**
 * Saves the portfolio, keeping the previous version as a .bak file. The new
 * file is written next to the old one and then swapped in, so the saved file
 * is never left half-written.
 */
function savePortfolio(string $path, array $portfolio): bool
{
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
        return false;
    }

    $contents = json_encode(
        [
            'savedAt' => gmdate(DATE_ATOM),
            'stocks' => $portfolio['stocks'],
            // An object, so that no holdings is saved as {} rather than [].
            'holdings' => (object) $portfolio['holdings'],
        ],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
    );

    $temporaryPath = @tempnam($directory, 'portfolio');
    if ($temporaryPath === false) {
        return false;
    }
    if (@file_put_contents($temporaryPath, $contents . "\n", LOCK_EX) === false) {
        @unlink($temporaryPath);
        return false;
    }

    if (is_file($path)) {
        @copy($path, $path . '.bak');
    }
    if (!@rename($temporaryPath, $path)) {
        @unlink($temporaryPath);
        return false;
    }

    return true;
}
