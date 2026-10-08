# pers-stock-panel

A lightweight PHP web app starter for a stock market dashboard.

## Features

- Two sections: "My current stocks" and "Stocks to monitor"
- Enter shares and average cost for stocks you own to see each position's value and gain/loss, plus portfolio totals including today's change and a breakdown of each stock's share of the portfolio
- Day, week, and month price changes, with each section sorted by today's change (best first)
- A small chart of each stock's price during regular trading hours, with the previous close as a dashed line
- Add, move and remove stocks in either section
- Stock lists, shares and costs are saved automatically to `data/portfolio.json`
- Live Yahoo Finance prices, refreshed every 5 seconds during regular trading hours, every 15 seconds during pre-market and after-hours trading, and every 2 minutes when nothing is trading (with an extra refresh as each session starts or ends)
- Pre-market and after-hours prices when extended-hours quotes are available
- Market status badge (open, pre-market, after-hours or closed) with a countdown to the next open or close; it follows the US market when you track any US stock, and does not know about exchange holidays when counting down over a weekend
- Refreshes slow down automatically (up to every 2 minutes) if Yahoo Finance rate-limits requests or the quote service fails, and return to normal once a refresh succeeds
- PHP endpoint that fetches quotes server-side; each refresh downloads only today's 1-minute data, while the 3-month daily history (used for the previous close and week/month changes) is cached for 5 minutes in the system temp folder (`stock-panel-daily`)

Requires PHP 8.2+ with the cURL extension enabled. Yahoo Finance is unofficial and may delay or block quote requests, especially at five-second polling intervals. Day change uses the latest quote against the prior trading day's close; week and month changes use the latest quote against the latest available daily close at least 7 or 30 calendar days earlier. Extended-hours prices are the latest available 1-minute close within that day's pre-market and after-hours sessions.

## Run locally

```bash
cd pers-stock-panel
php -S 127.0.0.1:8080 -t public
```

Then open http://127.0.0.1:8080 in your browser.

## Your data

Your stock lists, shares and average costs are saved to `data/portfolio.json` as you make changes, so they are the same in every browser on this computer. The previous version is kept as `data/portfolio.json.bak`. The `data` folder is not committed to Git.

- If `data/portfolio.json` does not exist, the page starts with the built-in stocks. The first time, it also copies in anything older versions of the app saved in that browser.
- If the file is damaged, it is renamed to `portfolio.json.invalid-<date>` rather than overwritten, and the page starts with the built-in stocks.
- Only the page itself can save: `public/data.php` accepts JSON from the same address only.

## Tests

The calculations behind the quote endpoint (previous close, week/month changes, pre-market and after-hours prices, chart points and market status) live in `src/quote_functions.php`, and saving and loading `data/portfolio.json` lives in `src/portfolio.php`. Both are covered by PHPUnit tests in `tests/`. The tests use made-up price data, so they do not contact Yahoo Finance and give the same result at any time of day.

```bash
composer install   # first time only
composer test
```

The JavaScript in `public/app.js` (portfolio totals, sorting, charts) is not covered by automated tests yet.
