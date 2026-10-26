<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The stocks table: one row per stock in My current stocks or Stocks to
 * monitor, with the shares and average cost entered for it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stocks', function (Blueprint $table) {
            $table->id();
            // Whose stock this is. Deleting the user deletes their stocks.
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('ticker', 10);
            // 'owned' (My current stocks) or 'monitor' (Stocks to monitor).
            $table->string('list', 10);
            // The order the page last had the stocks in.
            $table->unsignedSmallInteger('position');
            $table->double('shares')->nullable();
            $table->double('cost')->nullable();
            $table->timestamps();

            // A stock can only be in the lists once.
            $table->unique(['user_id', 'ticker']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stocks');
    }
};
