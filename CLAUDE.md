# Pers Stock Panel

A personal stock dashboard: PHP 8.5 on the server, being moved to Laravel 13 on the `laravel` branch (`app/`, `routes/`, `resources/views/`; the Yahoo Finance and data-file code is still plain PHP in `src/`), plain JavaScript and CSS in the browser (`public/app.js`, `public/styles.css`). Prices come from Yahoo Finance's unofficial chart endpoint. See README.md for features and how it is built.

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

## Deployment

The user's everyday app on http://127.0.0.1:8080 is an installed copy in `%LOCALAPPDATA%\PersStockPanel\app`, kept up to date from GitHub by scheduled tasks (`deploy/`, see README). Changes in this folder reach it only after commit, push and passing tests on GitHub (within 15 minutes; `Start-ScheduledTask 'Pers Stock Panel - update'` to update at once). Never edit the installed copy directly, and use other ports (not 8080) for manual checks.

## Rules

- Never read, write or delete `data/portfolio.json` (the user's real holdings) or `data/auth.json` (their password hash) in tests or experiments. The browser tests log in with their own test password in their own data folder. The browser tests use `STOCK_PANEL_DATA_DIR`; for manual checks, run a copy of the app on another port with that variable set.
- Commit and push to GitHub (`jejjcop/pers-stock-panel`, private) only when the user asks. End commit messages with the attribution line Claude Code provides.
- Keep the page's text in English. Answer the user in the language they write in (usually Swedish).
- The user is not a programmer: explain results and choices in plain words, and ask before installing software or changing Windows settings.
