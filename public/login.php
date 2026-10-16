<?php

declare(strict_types=1);

// Log in, or choose the password the first time the app is used.

require_once __DIR__ . '/../src/auth.php';

$authPath = authPath();
$passwordSet = isPasswordSet($authPath);
$error = null;

if (isLoggedIn()) {
    header('Location: ./', true, 303);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $password = (string) ($_POST['password'] ?? '');
    if (!isSameOriginRequest()) {
        $error = 'Logging in is only allowed from this page.';
    } elseif (!$passwordSet) {
        $error = isLocalRequest()
            ? setPassword($authPath, $password, (string) ($_POST['confirmation'] ?? ''))
            : 'The password can only be chosen on the computer the app runs on.';
        if ($error === null) {
            logIn();
            header('Location: ./', true, 303);
            exit;
        }
    } else {
        $result = attemptLogin($authPath, $password, time());
        if ($result['ok']) {
            logIn();
            header('Location: ./', true, 303);
            exit;
        }
        $error = $result['retryAfter'] > 0
            ? "Wrong password, or too many attempts. Try again in {$result['retryAfter']} seconds."
            : 'Wrong password.';
        // Answer wrong passwords slowly, to make guessing slower still.
        usleep(500_000);
    }
}

$canChoosePassword = !$passwordSet && isLocalRequest();
$notice = isset($_GET['expired']) && $error === null ? 'You have been logged out. Log in again to continue.' : null;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Log in · Pers Stock Panel</title>
    <link rel="stylesheet" href="styles.css?v=20">
</head>
<body>
    <main class="login-shell">
        <div class="panel login-panel">
            <p class="eyebrow">Pers Stock Panel</p>
            <?php if ($passwordSet): ?>
                <h1 class="login-title">Log in</h1>
            <?php else: ?>
                <h1 class="login-title">Choose a password</h1>
                <p class="login-intro">This is the first time the app is used. Choose the password you will log in with; it is stored only on this computer, encrypted.</p>
            <?php endif; ?>

            <?php if ($notice !== null): ?>
                <p class="login-message" role="status"><?= htmlspecialchars($notice) ?></p>
            <?php endif; ?>
            <?php if ($error !== null): ?>
                <p class="login-message is-error" role="alert"><?= htmlspecialchars($error) ?></p>
            <?php endif; ?>

            <?php if ($passwordSet || $canChoosePassword): ?>
                <form method="post" class="login-form">
                    <label class="search-box" for="password">
                        <span>Password</span>
                        <input id="password" name="password" type="password" required autofocus
                            minlength="<?= $passwordSet ? 1 : PASSWORD_MIN_LENGTH ?>"
                            autocomplete="<?= $passwordSet ? 'current-password' : 'new-password' ?>">
                    </label>
                    <?php if (!$passwordSet): ?>
                        <label class="search-box" for="confirmation">
                            <span>The same password again</span>
                            <input id="confirmation" name="confirmation" type="password" required
                                minlength="<?= PASSWORD_MIN_LENGTH ?>" autocomplete="new-password">
                        </label>
                    <?php endif; ?>
                    <button class="primary-button" type="submit"><?= $passwordSet ? 'Log in' : 'Save password and log in' ?></button>
                </form>
            <?php else: ?>
                <p class="login-message is-error" role="alert">No password has been chosen yet. Open the app on the computer it runs on to choose one.</p>
            <?php endif; ?>
        </div>
    </main>
</body>
</html>
