<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Lets a request through only when it comes from a logged-in browser.
 *
 * Middleware runs before the controller. Routes use it as 'logged.in' for
 * pages, which go to the login page, or 'logged.in:json' for the addresses
 * the page fetches data from, which answer 401 instead.
 */
class RequireLogin
{
    public function handle(Request $request, Closure $next, string $answer = 'page'): Response
    {
        if (Auth::check()) {
            return $next($request);
        }

        if ($answer === 'json') {
            return response()->json(['error' => 'You are not logged in.'], 401);
        }

        return redirect()->route('login', status: 303);
    }
}
