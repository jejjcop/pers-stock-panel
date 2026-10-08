// @ts-check
const path = require('node:path');
const os = require('node:os');
const { defineConfig, devices } = require('@playwright/test');

const port = 8095;
// The app saves to this folder instead of data/ while the tests run.
const dataDir = path.join(os.tmpdir(), 'pers-stock-panel-browser-tests');
process.env.STOCK_PANEL_TEST_DATA_DIR = dataDir;

module.exports = defineConfig({
    testDir: './tests/browser',
    // The tests share one data file, so they run one at a time.
    workers: 1,
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        // Fixes number and currency formatting, e.g. $20,672.00.
        locale: 'en-US',
        timezoneId: 'Europe/Stockholm',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    ],
    webServer: {
        command: `php -S 127.0.0.1:${port} -t public`,
        url: `http://127.0.0.1:${port}/index.php`,
        reuseExistingServer: false,
        env: { STOCK_PANEL_DATA_DIR: dataDir },
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
