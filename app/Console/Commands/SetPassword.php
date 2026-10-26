<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Sets a new password, for when the old one is forgotten. Your stocks are
 * not affected.
 *
 * Run with: php artisan stock-panel:set-password
 */
class SetPassword extends Command
{
    protected $signature = 'stock-panel:set-password';

    protected $description = 'Choose a new password for logging in to the app';

    public function handle(): int
    {
        // secret() asks without showing what is typed.
        $password = (string) $this->secret('New password');
        if (mb_strlen($password) < User::PASSWORD_MIN_LENGTH) {
            $this->error('The password must be at least ' . User::PASSWORD_MIN_LENGTH . ' characters long. Nothing was changed.');
            return self::FAILURE;
        }
        if ((string) $this->secret('The same password again') !== $password) {
            $this->error('The two passwords are not the same. Nothing was changed.');
            return self::FAILURE;
        }

        $user = User::query()->first() ?? new User(['name' => 'owner']);
        // The model hashes it before saving (see its casts).
        $user->password = $password;
        $user->failed_logins = 0;
        $user->locked_until = null;
        $user->save();

        $this->info('The new password is saved. Log in with it in the app.');

        return self::SUCCESS;
    }
}
