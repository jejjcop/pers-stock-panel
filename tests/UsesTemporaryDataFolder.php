<?php

namespace Tests;

/**
 * Points the app at an empty data folder of the test's own, so tests never
 * touch the real files in data/.
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

    protected function writeDataFile(string $name, string|array $contents): void
    {
        file_put_contents($this->dataFile($name), is_array($contents) ? json_encode($contents) : $contents);
    }
}
