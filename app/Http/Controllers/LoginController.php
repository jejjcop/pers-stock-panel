<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

/**
 * Logging in and out, and choosing the password the first time.
 *
 * Uses Laravel's Auth: Auth::attempt() checks a password against the users
 * table, and Auth::check() (in the RequireLogin middleware) tells whether
 * this browser is logged in.
 */
class LoginController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        if (Auth::check()) {
            return redirect()->route('dashboard', status: 303);
        }

        $passwordSet = User::query()->exists();

        return view('login', [
            'passwordSet' => $passwordSet,
            'canChoosePassword' => !$passwordSet && $this->isLocal($request),
            'minLength' => User::PASSWORD_MIN_LENGTH,
            'notice' => $request->has('expired') ? 'You have been logged out. Log in again to continue.' : null,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $user = User::query()->first();

        if ($user === null) {
            return $this->chooseFirstPassword($request);
        }

        $request->validate(['password' => ['required', 'string']]);

        $wait = $user->secondsUntilUnlocked();
        if ($wait > 0) {
            return $this->refuse("Wrong password, or too many attempts. Try again in {$wait} seconds.");
        }

        // Checks the password against the hash in the users table, and logs
        // this browser in when it matches.
        if (Auth::attempt(['id' => $user->id, 'password' => (string) $request->input('password')])) {
            $user->recordSuccessfulLogin();
            return $this->loggedIn($request);
        }

        $user->recordFailedLogin();
        $wait = User::lockSeconds($user->failed_logins);

        return $this->refuse($wait > 0
            ? "Wrong password, or too many attempts. Try again in {$wait} seconds."
            : 'Wrong password.');
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::logout();
        // Forgets everything in the session and gives the browser a new,
        // empty one.
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login', status: 303);
    }

    private function chooseFirstPassword(Request $request): RedirectResponse
    {
        // Only allowed from the computer the app runs on, so nobody else
        // can claim a fresh install.
        if (!$this->isLocal($request)) {
            return back(303)->withErrors(['password' => 'The password can only be chosen on the computer the app runs on.']);
        }

        // Validation: if a rule fails, Laravel goes back to the form with
        // the message, and the rest of this method does not run.
        $request->validate([
            'password' => ['required', 'string', 'min:' . User::PASSWORD_MIN_LENGTH, 'confirmed'],
        ], [
            'password.min' => 'The password must be at least :min characters long.',
            'password.confirmed' => 'The two passwords are not the same.',
        ]);

        // The model hashes the password before saving it (see its casts).
        $user = User::create(['name' => 'owner', 'password' => (string) $request->input('password')]);
        Auth::login($user);

        return $this->loggedIn($request);
    }

    private function loggedIn(Request $request): RedirectResponse
    {
        // A new session id at login, so an id seen before login is worthless.
        $request->session()->regenerate();

        return redirect()->route('dashboard', status: 303);
    }

    private function refuse(string $message): RedirectResponse
    {
        // Answer wrong passwords slowly, to make guessing slower still.
        usleep(500_000);

        return back(303)->withErrors(['password' => $message]);
    }

    private function isLocal(Request $request): bool
    {
        return in_array($request->ip(), ['127.0.0.1', '::1'], true);
    }
}
