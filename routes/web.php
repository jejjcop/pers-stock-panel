<?php

use App\Http\Controllers\DashboardController;
use Illuminate\Support\Facades\Route;

// Each route connects a web address to the code that answers it.
//
// The other addresses (quotes.php, history.php, data.php, login.php and
// logout.php) are still the old PHP files in public/; they move here one by
// one in the next steps.

Route::get('/', DashboardController::class)->name('dashboard');
