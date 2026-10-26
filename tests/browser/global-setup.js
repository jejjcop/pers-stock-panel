// @ts-check
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Runs once before the browser tests: creates an empty database with all of
 * the app's tables (php artisan migrate) in a folder of its own. Each test
 * starts from a copy of it (see writePortfolio in helpers.js).
 */
module.exports = function globalSetup() {
    // The tests' data folder from an earlier run may have older tables.
    fs.rmSync(/** @type {string} */ (process.env.STOCK_PANEL_TEST_DATA_DIR), { recursive: true, force: true });

    const templateDir = /** @type {string} */ (process.env.STOCK_PANEL_TEST_TEMPLATE_DIR);
    fs.rmSync(templateDir, { recursive: true, force: true });
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'database.sqlite'), '');

    execFileSync('php', ['artisan', 'migrate', '--force', '--no-interaction'], {
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env, STOCK_PANEL_DATA_DIR: templateDir },
        stdio: 'pipe',
    });
};
