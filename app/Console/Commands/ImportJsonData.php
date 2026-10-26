<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Copies the password and stock lists that older versions kept in
 * data/auth.json and data/portfolio.json into the database.
 *
 * Run with: php artisan stock-panel:import-json
 *
 * It only imports into a database without a user, so running it again (for
 * example after every update) changes nothing. The JSON files are left as
 * they are, as a backup.
 */
class ImportJsonData extends Command
{
    protected $signature = 'stock-panel:import-json';

    protected $description = 'Copy the password and stocks from data/auth.json and data/portfolio.json into the database';

    public function handle(): int
    {
        if (User::query()->exists()) {
            $this->info('The database already has the password and stocks; nothing to import.');
            return self::SUCCESS;
        }

        $auth = loadAuth(authPath());
        if ($auth['passwordHash'] === null) {
            $this->info('There is no password in ' . authPath() . ' to import; the app will ask you to choose one.');
            return self::SUCCESS;
        }

        $portfolioPath = portfolioPath();
        $portfolio = loadPortfolio($portfolioPath);
        if ($portfolio === null && is_file($portfolioPath)) {
            $this->error($portfolioPath . ' could not be read, so nothing was imported. Repair or move the file, then run this again.');
            return self::FAILURE;
        }

        DB::transaction(function () use ($auth, $portfolio) {
            $user = new User();
            // The hash is copied as it is: it already is one, so it must not
            // be hashed again.
            $user->setRawAttributes([
                'name' => 'owner',
                'password' => $auth['passwordHash'],
                'failed_logins' => $auth['failedAttempts'],
                'locked_until' => $auth['lockedUntil'] > time() ? date('Y-m-d H:i:s', $auth['lockedUntil']) : null,
            ]);
            $user->save();

            // Without a saved portfolio the page starts with the built-in
            // stocks, as before.
            if ($portfolio !== null) {
                $user->savePortfolio($portfolio);
            }
        });

        $this->info('Imported the password' . ($portfolio !== null ? ' and ' . count($portfolio['stocks']) . ' stocks' : '') . ' into the database.');

        return self::SUCCESS;
    }
}
