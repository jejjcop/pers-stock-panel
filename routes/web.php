<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\HistoryController;
use App\Http\Controllers\LoginController;
use App\Http\Controllers\PortfolioController;
use App\Http\Controllers\QuoteController;
use Illuminate\Support\Facades\Route;

// Each route connects a web address to the code that answers it.

// Open to everyone: logging in and out.
Route::get('/login', [LoginController::class, 'show'])->name('login');
Route::post('/login', [LoginController::class, 'store']);
Route::post('/logout', [LoginController::class, 'destroy'])->name('logout');

// The page itself: without a login, the middleware sends you to /login.
Route::get('/', DashboardController::class)->middleware('logged.in')->name('dashboard');

// The addresses the page fetches data from: without a login they answer
// 401, which the page turns into a visit to the login page.
Route::middleware('logged.in:json')->group(function () {
    Route::get('/quotes', QuoteController::class);
    Route::get('/history', HistoryController::class);
    Route::post('/portfolio', [PortfolioController::class, 'store']);
});
