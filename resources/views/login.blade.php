{{-- The login page. LoginController hands it $passwordSet, $canChoosePassword, $minLength and $notice. --}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Log in · Pers Stock Panel</title>
    <link rel="stylesheet" href="styles.css?v=22">
</head>
<body>
    <main class="login-shell">
        <div class="panel login-panel">
            <p class="eyebrow">Pers Stock Panel</p>
            @if ($passwordSet)
                <h1 class="login-title">Log in</h1>
            @else
                <h1 class="login-title">Choose a password</h1>
                <p class="login-intro">This is the first time the app is used. Choose the password you will log in with; it is stored only on this computer, encrypted.</p>
            @endif

            @if ($notice !== null)
                <p class="login-message" role="status">{{ $notice }}</p>
            @endif
            {{-- The message from the last attempt, if it failed. --}}
            @error('password')
                <p class="login-message is-error" role="alert">{{ $message }}</p>
            @enderror

            @if ($passwordSet || $canChoosePassword)
                <form method="post" action="{{ route('login') }}" class="login-form">
                    {{-- The hidden token that proves the form came from this site. --}}
                    @csrf
                    <label class="search-box" for="password">
                        <span>Password</span>
                        <input id="password" name="password" type="password" required autofocus
                            minlength="{{ $passwordSet ? 1 : $minLength }}"
                            autocomplete="{{ $passwordSet ? 'current-password' : 'new-password' }}">
                    </label>
                    @if (!$passwordSet)
                        <label class="search-box" for="password_confirmation">
                            <span>The same password again</span>
                            <input id="password_confirmation" name="password_confirmation" type="password" required
                                minlength="{{ $minLength }}" autocomplete="new-password">
                        </label>
                    @endif
                    <button class="primary-button" type="submit">{{ $passwordSet ? 'Log in' : 'Save password and log in' }}</button>
                </form>
            @else
                <p class="login-message is-error" role="alert">No password has been chosen yet. Open the app on the computer it runs on to choose one.</p>
            @endif
        </div>
    </main>
</body>
</html>
