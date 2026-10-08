<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/StockPanel.php';

use StockPanel\StockPanel;

$sections = [
    'owned' => [
        'eyebrow' => 'Portfolio',
        'title' => 'My current stocks',
        'empty' => 'No stocks here yet. Add a ticker above and choose "My current stocks".',
        'stocks' => StockPanel::watchlist(),
    ],
    'monitor' => [
        'eyebrow' => 'Watchlist',
        'title' => 'Stocks to monitor',
        'empty' => 'No stocks here yet. Add a ticker above and choose "Stocks to monitor".',
        'stocks' => [],
    ],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pers Stock Panel</title>
    <link rel="stylesheet" href="styles.css?v=14">
</head>
<body>
    <div class="page-shell">
        <header class="topbar">
            <div>
                <p class="eyebrow">Market overview</p>
                <h1>Pers Stock Panel</h1>
            </div>
            <div class="topbar-actions">
                <div id="market-status" class="market-status" hidden>
                    <span class="market-status-dot" aria-hidden="true"></span>
                    <span>
                        <strong id="market-status-label"></strong>
                        <small id="market-status-countdown"></small>
                    </span>
                </div>
                <button id="refresh-quotes" class="primary-button" type="button">Refresh prices</button>
            </div>
        </header>

        <main class="dashboard">
            <section class="panel controls-panel">
                <div class="panel-header">
                    <div>
                        <p class="eyebrow">Manage</p>
                        <h2>Add a stock</h2>
                    </div>
                    <div class="watchlist-tools">
                        <form id="add-stock-form" class="add-stock-form">
                            <label class="search-box" for="new-ticker">
                                <span>Ticker</span>
                                <input
                                    id="new-ticker"
                                    name="ticker"
                                    type="text"
                                    placeholder="e.g. TSLA"
                                    maxlength="10"
                                    pattern="[A-Za-z0-9][A-Za-z0-9.-]{0,9}"
                                    title="Use up to 10 letters, numbers, dots or hyphens."
                                    autocomplete="off"
                                    required
                                >
                            </label>
                            <label class="search-box" for="new-list">
                                <span>Add to</span>
                                <select id="new-list" name="list">
                                    <?php foreach ($sections as $list => $section): ?>
                                        <option value="<?= htmlspecialchars($list) ?>"><?= htmlspecialchars($section['title']) ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </label>
                            <button class="primary-button" type="submit">Add stock</button>
                        </form>
                    </div>
                </div>
                <p id="watchlist-status" class="watchlist-status" role="status" aria-live="polite">Connecting to Yahoo Finance...</p>
                <p id="refresh-countdown" class="refresh-countdown" aria-live="off">Updating prices...</p>
            </section>

            <?php foreach ($sections as $list => $section): ?>
                <section class="panel" data-section="<?= htmlspecialchars($list) ?>">
                    <div class="panel-header">
                        <div>
                            <p class="eyebrow"><?= htmlspecialchars($section['eyebrow']) ?></p>
                            <h2><?= htmlspecialchars($section['title']) ?></h2>
                        </div>
                        <?php if ($list === 'owned'): ?>
                            <div id="portfolio-summary" class="portfolio-summary" hidden>
                                <div>
                                    <span>Total cost</span>
                                    <strong id="portfolio-cost">—</strong>
                                </div>
                                <div>
                                    <span>Total value</span>
                                    <strong id="portfolio-value">—</strong>
                                </div>
                                <div>
                                    <span>Today</span>
                                    <strong id="portfolio-day">—</strong>
                                </div>
                                <div>
                                    <span>Total gain / loss</span>
                                    <strong id="portfolio-gain">—</strong>
                                </div>
                            </div>
                        <?php endif; ?>
                    </div>

                    <p id="<?= htmlspecialchars($list) ?>-empty" class="empty-message"<?= $section['stocks'] === [] ? '' : ' hidden' ?>><?= htmlspecialchars($section['empty']) ?></p>

                    <div class="table-wrap"<?= $section['stocks'] === [] ? ' hidden' : '' ?>>
                        <table>
                            <thead>
                                <tr>
                                    <th>Ticker</th>
                                    <th>Name</th>
                                    <th class="holding-cell">Shares</th>
                                    <th class="holding-cell">Avg cost</th>
                                    <th class="holding-cell">Total cost</th>
                                    <th>Price</th>
                                    <th class="holding-cell">Value</th>
                                    <th class="holding-cell">Gain / loss</th>
                                    <th class="day-column" aria-sort="descending">Day <span aria-hidden="true">↓</span></th>
                                    <th>Today</th>
                                    <th>Week</th>
                                    <th>Month</th>
                                    <th>Volume</th>
                                    <th>Pre-market / After-hours</th>
                                    <th><span class="visually-hidden">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody data-list="<?= htmlspecialchars($list) ?>">
                                <?php foreach ($section['stocks'] as $stock): ?>
                                    <tr data-ticker="<?= htmlspecialchars((string) $stock['ticker']) ?>">
                                        <td><?= htmlspecialchars((string) $stock['ticker']) ?></td>
                                        <td class="quote-name"><?= htmlspecialchars((string) $stock['name']) ?></td>
                                        <td class="quote-price">—</td>
                                        <td class="quote-change">—</td>
                                        <td class="quote-chart">—</td>
                                        <td class="quote-week">—</td>
                                        <td class="quote-month">—</td>
                                        <td class="quote-volume">—</td>
                                        <td class="extended-hours-cell">
                                            <span class="extended-hours-value">—</span>
                                        </td>
                                        <td class="action-cell"></td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </section>

                <?php if ($list === 'owned'): ?>
                    <section id="allocation-panel" class="panel" hidden>
                        <div class="panel-header">
                            <div>
                                <p class="eyebrow">Portfolio</p>
                                <h2>Portfolio breakdown</h2>
                            </div>
                        </div>
                        <p class="allocation-note">Each stock's share of the total value of My current stocks.</p>
                        <div id="allocation-list" class="allocation-list"></div>
                    </section>
                <?php endif; ?>
            <?php endforeach; ?>
        </main>
    </div>

    <dialog id="remove-dialog" class="confirm-dialog" aria-labelledby="remove-dialog-title" aria-describedby="remove-dialog-message">
        <form method="dialog">
            <h2 id="remove-dialog-title">Remove stock?</h2>
            <p id="remove-dialog-message"></p>
            <div class="dialog-actions">
                <button class="secondary-button" type="submit" value="cancel" autofocus>Cancel</button>
                <button class="danger-button" type="submit" value="confirm">Remove</button>
            </div>
        </form>
    </dialog>

    <script src="app.js?v=28"></script>
</body>
</html>
