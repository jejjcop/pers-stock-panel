<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The users table. The app has a single user: whoever chose the password.
 *
 * A migration describes a change to the database. `php artisan migrate`
 * runs the ones that have not run yet (up), and `migrate:rollback` undoes
 * them (down).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            // Only a hash of the password, never the password itself.
            $table->string('password');
            // Wrong passwords in a row, and until when logging in is paused.
            $table->unsignedInteger('failed_logins')->default(0);
            $table->timestamp('locked_until')->nullable();
            // When the page last saved the stock lists; empty until then, so
            // the page knows to start with the built-in stocks.
            $table->timestamp('portfolio_saved_at')->nullable();
            $table->rememberToken();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
