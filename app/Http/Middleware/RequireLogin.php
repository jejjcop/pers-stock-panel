<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
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
        if ($request->session()->get('logged_in') === true) {
            return $next($request);
        }

        if ($answer === 'json') {
            return response()->json(['error' => 'You are not logged in.'], 401);
        }

        return redirect()->route('login', status: 303);
    }
}
