<?php

namespace Tests;

/**
 * Points the app at an empty data folder of the test's own, so tests never
 * touch data/portfolio.json or data/auth.json.
 */
trait UsesTemporaryDataFolder
{
    protected string $dataDirectory;

    protected function setUpDataFolder(): void
    {
        $this->dataDirectory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'stock-panel-test-' . bin2hex(random_bytes(6));
        mkdir($this->dataDirectory);
        putenv('STOCK_PANEL_DATA_DIR=' . $this->dataDirectory);
    }

    protected function tearDownDataFolder(): void
    {
        array_map('unlink', glob($this->dataDirectory . DIRECTORY_SEPARATOR . '*') ?: []);
        rmdir($this->dataDirectory);
        putenv('STOCK_PANEL_DATA_DIR');
    }

    protected function dataFile(string $name): string
    {
        return $this->dataDirectory . DIRECTORY_SEPARATOR . $name;
    }

    protected function writeDataFile(string $name, array $data): void
    {
        file_put_contents($this->dataFile($name), json_encode($data));
    }

    /** Sets up auth.json with this password, as if it had been chosen before. */
    protected function choosePassword(string $password): void
    {
        $this->writeDataFile('auth.json', ['passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'failedAttempts' => 0, 'lockedUntil' => 0]);
    }
}
