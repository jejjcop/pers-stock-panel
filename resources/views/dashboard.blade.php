{{-- The main page. DashboardController hands it $sections and $pageData. --}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pers Stock Panel</title>
    {{-- For public/app.js: the token Laravel checks on requests that save. --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <link rel="stylesheet" href="styles.css?v=22">
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
                <form method="post" action="{{ route('logout') }}">
                    @csrf
                    <button class="secondary-button" type="submit">Log out</button>
                </form>
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
                                    pattern="[A-Za-z0-9][A-Za-z0-9.\-]{0,9}"
                                    title="Use up to 10 letters, numbers, dots or hyphens."
                                    autocomplete="off"
                                    required
                                >
                            </label>
                            <label class="search-box" for="new-list">
                                <span>Add to</span>
                                <select id="new-list" name="list">
                                    @foreach ($sections as $list => $section)
                                        <option value="{{ $list }}">{{ $section['title'] }}</option>
                                    @endforeach
                                </select>
                            </label>
                            <button class="primary-button" type="submit">Add stock</button>
                        </form>
                    </div>
                </div>
                <p id="watchlist-status" class="watchlist-status" role="status" aria-live="polite">Connecting to Yahoo Finance...</p>
                <p id="stream-status" class="stream-status" data-state="connecting">
                    <span class="stream-status-dot" aria-hidden="true"></span>
                    <span id="stream-status-text">Connecting to live prices...</span>
                </p>
                <p id="refresh-countdown" class="refresh-countdown" aria-live="off">Updating prices...</p>
                <p id="save-status" class="save-status" role="status" aria-live="polite">Your stocks are saved automatically on this computer.</p>
            </section>

            @foreach ($sections as $list => $section)
                <section class="panel" data-section="{{ $list }}">
                    <div class="panel-header">
                        <div>
                            <p class="eyebrow">{{ $section['eyebrow'] }}</p>
                            <h2>{{ $section['title'] }}</h2>
                        </div>
                        @if ($list === 'owned')
                            <div id="portfolio-summary" class="portfolio-summary" hidden>
                                <div>
                                    <span>Total cost</span>
                                    <strong id="portfolio-cost">—</strong>
                                </div>
                                <div>
                                    <span>Total value</span>
                                    <strong id="portfolio-value">—</strong>
                                    <small id="portfolio-value-sek" class="sek-amount" hidden></small>
                                </div>
                                <div>
                                    <span class="day-label">Today</span>
                                    <strong id="portfolio-day">—</strong>
                                    <small id="portfolio-day-sek" class="sek-amount" hidden></small>
                                </div>
                                <div>
                                    <span>Total gain / loss</span>
                                    <strong id="portfolio-gain">—</strong>
                                </div>
                            </div>
                        @endif
                    </div>

                    @if ($list === 'owned')
                        <p id="fx-note" class="fx-note" hidden></p>
                    @endif

                    <p id="{{ $list }}-empty" class="empty-message" @if ($section['stocks'] !== []) hidden @endif>{{ $section['empty'] }}</p>

                    <div class="table-wrap" @if ($section['stocks'] === []) hidden @endif>
                        <table>
                            <thead>
                                <tr>
                                    <th>Stock</th>
                                    <th class="holding-cell">Shares</th>
                                    <th class="holding-cell">Avg cost</th>
                                    <th>Price</th>
                                    <th class="holding-cell">Value</th>
                                    <th class="holding-cell">Gain / loss</th>
                                    <th class="day-column" aria-sort="descending"><span class="day-label">Today</span> <span aria-hidden="true">↓</span></th>
                                    <th class="col-chart">Chart</th>
                                    <th>Week / Month</th>
                                    <th class="col-volume">Volume</th>
                                    <th><span class="visually-hidden">Actions</span></th>
                                </tr>
                            </thead>
                            <!-- Rows are built by app.js from the page data below. -->
                            <tbody data-list="{{ $list }}"></tbody>
                        </table>
                    </div>
                </section>

                @if ($list === 'owned')
                    <section id="live-charts-panel" class="panel" hidden>
                        <div class="panel-header">
                            <div>
                                <p class="eyebrow">Portfolio</p>
                                <h2><span class="day-label">Today</span>'s graphs</h2>
                            </div>
                        </div>
                        <p class="live-charts-note">Each stock's price through the trading day, moving with every live trade. The dotted line is the previous close. Point at a graph to see the price at that time.</p>
                        <!-- Cards are built by app.js, one per stock in My current stocks. -->
                        <div id="live-charts" class="live-charts"></div>
                    </section>

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
                @endif
            @endforeach
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

    <dialog id="chart-dialog" class="chart-dialog" aria-labelledby="chart-dialog-title">
        <div class="chart-dialog-header">
            <div>
                <h2 id="chart-dialog-title"></h2>
                <p id="chart-dialog-name" class="chart-dialog-name"></p>
            </div>
            <form method="dialog">
                <button class="secondary-button" type="submit" aria-label="Close chart">Close</button>
            </form>
        </div>
        <div class="chart-dialog-toolbar">
            <div class="range-buttons" role="group" aria-label="Chart period">
                <button type="button" data-range="1d" aria-pressed="true">1D</button>
                <button type="button" data-range="1w" aria-pressed="false">1W</button>
                <button type="button" data-range="1m" aria-pressed="false">1M</button>
                <button type="button" data-range="1y" aria-pressed="false">1Y</button>
                <button type="button" data-range="5y" aria-pressed="false">5Y</button>
            </div>
            <p id="chart-dialog-change" class="chart-dialog-change"></p>
        </div>
        <div id="chart-dialog-plot" class="chart-dialog-plot">
            <div id="chart-dialog-tooltip" class="chart-dialog-tooltip" hidden></div>
        </div>
        <p id="chart-dialog-status" class="chart-dialog-status" role="status" aria-live="polite"></p>
    </dialog>

    <script id="portfolio-data" type="application/json">{!! json_encode($pageData, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR) !!}</script>
    <script src="price-stream.js?v=1"></script>
    <script src="app.js?v=38"></script>
</body>
</html>
