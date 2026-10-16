<?php

declare(strict_types=1);

// Logs out and returns to the login page.

require_once __DIR__ . '/../src/auth.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !isSameOriginRequest()) {
    http_response_code(405);
    header('Allow: POST');
    exit;
}

logOut();
header('Location: login.php', true, 303);
