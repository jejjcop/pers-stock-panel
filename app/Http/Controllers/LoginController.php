<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Logging in and out, and choosing the password the first time.
 *
 * The password hash and the count of wrong attempts stay in auth.json
 * (src/auth.php) for now; whether you are logged in is kept in Laravel's
 * session.
 */
class LoginController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        if ($request->session()->get('logged_in') === true) {
            return redirect()->route('dashboard', status: 303);
        }

        $passwordSet = isPasswordSet(authPath());

        return view('login', [
            'passwordSet' => $passwordSet,
            'canChoosePassword' => !$passwordSet && $this->isLocal($request),
            'notice' => $request->has('expired') ? 'You have been logged out. Log in again to continue.' : null,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $authPath = authPath();

        if (!isPasswordSet($authPath)) {
            // Choosing the first password is only allowed from the computer
            // the app runs on, so nobody else can claim a fresh install.
            if (!$this->isLocal($request)) {
                return back(303)->withErrors(['password' => 'The password can only be chosen on the computer the app runs on.']);
            }

            // Validation: if a rule fails, Laravel goes back to the form with
            // the message, and the rest of this method does not run.
            $request->validate([
                'password' => ['required', 'string', 'min:' . PASSWORD_MIN_LENGTH, 'confirmed'],
            ], [
                'password.min' => 'The password must be at least :min characters long.',
                'password.confirmed' => 'The two passwords are not the same.',
            ]);

            $error = setPassword($authPath, (string) $request->input('password'), (string) $request->input('password_confirmation'));
            if ($error !== null) {
                return back(303)->withErrors(['password' => $error]);
            }

            return $this->logIn($request);
        }

        $request->validate(['password' => ['required', 'string']]);

        $result = attemptLogin($authPath, (string) $request->input('password'), time());
        if ($result['ok']) {
            return $this->logIn($request);
        }

        // Answer wrong passwords slowly, to make guessing slower still.
        usleep(500_000);

        return back(303)->withErrors(['password' => $result['retryAfter'] > 0
            ? "Wrong password, or too many attempts. Try again in {$result['retryAfter']} seconds."
            : 'Wrong password.']);
    }

    public function destroy(Request $request): RedirectResponse
    {
        // Forgets everything in the session and gives the browser a new,
        // empty one.
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login', status: 303);
    }

    private function logIn(Request $request): RedirectResponse
    {
        // A new session id at login, so an id seen before login is worthless.
        $request->session()->regenerate();
        $request->session()->put('logged_in', true);

        return redirect()->route('dashboard', status: 303);
    }

    private function isLocal(Request $request): bool
    {
        return in_array($request->ip(), ['127.0.0.1', '::1'], true);
    }
}
