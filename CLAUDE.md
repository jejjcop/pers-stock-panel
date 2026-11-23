# Pers Stock Panel

A personal stock dashboard: PHP 8.5 on the server with Laravel 13, on `main` (`app/`, `routes/`, `resources/views/`; the calculations on Yahoo's data are plain functions in `src/quote_functions.php`), plain JavaScript and CSS in the browser (`public/app.js`, `public/styles.css`). Prices come from Yahoo Finance's unofficial chart endpoint. See README.md for features and how it is built.

## Stack

- PHP 8.5 locally (composer.json allows ^8.3), Laravel 13, SQLite: `data/database.sqlite`, or the folder `STOCK_PANEL_DATA_DIR` points to. The PHP tests use an in-memory SQLite database (`phpunit.xml`).
- Blade views (`resources/views/dashboard.blade.php`, `login.blade.php`), plain CSS with no framework, and plain JavaScript with no build step.
- Yahoo Finance via Laravel's HTTP client in `app/Services/YahooFinance.php` (several charts at once, cached in Laravel's cache). Claude via `anthropic-ai/sdk` in `app/Services/StockAssistant.php`.

## Commands

- Run one PHP test class or method: `php artisan test --filter=PortfolioTest`
- Run one browser test file: `npx playwright test tests/browser/holdings.spec.js`; by test name: `npx playwright test -g "part of the name"`
- The app's own artisan commands: `stock-panel:set-password` and `stock-panel:import-json` (moves the old `portfolio.json`/`auth.json` into the database). Never run them against the real data folder (see Rules).

## Data and prices

- Two tables. `users` holds the single user: password hash, failed logins and lockout, and when the lists were last saved. `stocks` has one row per stock: `ticker`, `list` (`owned` = My current stocks, `monitor` = Stocks to monitor), `position` (order on the page), and `shares` and `cost` (average cost), both `double`, empty until entered. There is no transactions table.
- Prices are never stored in the database. They're fetched from Yahoo when the page asks and cached for between 60 seconds and an hour, depending on the chart (`src/quote_functions.php`, `app/Services/QuoteBoard.php`). Chart prices are rounded to 4 decimals, and percentages to 2 only when shown or sent to Claude.
- `User::savePortfolio()` replaces all of a user's stock rows in one transaction. `User::portfolio()` returns the shape `public/app.js` uses.

## Conventions

- Calculations on Yahoo's data are plain functions in `src/` with unit tests in `tests/Unit` that don't start Laravel. Controllers and `app/Services` connect them to requests.
- There are no Form Request classes. Small checks use `$request->validate()` in the controller. The stock lists are checked by `normalizePortfolio()` in `src/portfolio.php` before anything is saved.
- Every route except login and logout is behind the `logged.in` middleware. The page redirects to `/login`, and the JSON addresses answer 401. A new route gets a Feature test, including one for a visitor who isn't logged in.
- Tests fake the outside world with `tests/FakesYahoo.php` (`Http::fake()`) and `tests/FakesClaude.php`, and use their own data folder (`tests/UsesTemporaryDataFolder.php`).
- Code comments explain why, in plain English, for a reader who is learning Laravel.

## Testing — required after every code change

After changing anything in `app/`, `config/`, `routes/`, `resources/`, `public/`, `src/`, `tests/` or the test configuration, run both test suites before reporting the work as done, and tell the user the result:

```bash
composer test          # PHP tests (PHPUnit)
npm run test:browser   # browser tests (Playwright)
```

- New behaviour gets new tests; a bug fix gets a test that fails without the fix. When practical, show that the new test fails against the old code.
- For visible changes, also take screenshots with Playwright and look at them; the tests do not check how things look.
- A Stop hook (`.claude/settings.json`, `.claude/hooks/run-tests.js`) also runs both suites when code changed since the last passing run. It is a safety net, not a replacement for running the tests yourself.
- If Node, Composer or Git are not found, the tools are installed but the session's PATH may be stale: Node is in `C:\Program Files\nodejs`, Composer in `%LOCALAPPDATA%\Programs\Composer`, Git in `C:\Program Files\Git\cmd`.

## Security review — required before every commit

Before committing, run `/security-review` on the changes, fix what it finds (with tests, as for any bug) or explain to the user why a finding does not apply, and tell the user the result. GitHub Actions (`.github/workflows/tests.yml`) currently runs only the PHP tests, not `composer audit`, `npm audit` or the browser tests, so also run `composer audit` and `npm audit` before committing and tell the user if a library has a published security hole.

## Deployment

The user's everyday app on http://127.0.0.1:8080 is an installed copy in `%LOCALAPPDATA%\PersStockPanel\app`, kept up to date from GitHub by scheduled tasks (`deploy/`, see README). Changes in this folder reach it only after commit, push and passing tests on GitHub (within 15 minutes; `Start-ScheduledTask 'Pers Stock Panel - update'` to update at once). Never edit the installed copy directly, and use other ports (not 8080) for manual checks.

## Rules

- Never read, write or delete `data/database.sqlite` (the user's real holdings and password hash), `data/portfolio.json` or `data/auth.json` (the same, as older versions saved them) in tests or experiments, and never run artisan commands against the real data folder. The browser tests log in with their own test password in their own data folder. The browser tests use `STOCK_PANEL_DATA_DIR`; for manual checks, run a copy of the app on another port with that variable set.
- Commit and push to GitHub (`jejjcop/pers-stock-panel`, private) only when the user asks. End commit messages with the attribution line Claude Code provides.
- Keep the page's text in English. Answer the user in the language they write in (usually Swedish).
- The user is not a programmer: explain results and choices in plain words, and ask before installing software or changing Windows settings.
- Never change a migration that has already run (the real database has run them all); add a new migration instead.
- Ask before adding a Composer or npm package, and name it in the summary of the work.
- Tests never contact Yahoo or Anthropic; use the fakes above.
