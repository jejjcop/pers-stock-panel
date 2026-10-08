<?php

declare(strict_types=1);

// Saves the page's stock lists and holdings to data/portfolio.json.

ini_set('display_errors', '0');
ini_set('log_errors', '1');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/../src/portfolio.php';

function respondJson(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_THROW_ON_ERROR);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respondJson(405, ['error' => 'Only POST requests are supported.']);
}

// Only this page may save. Browsers send an Origin header with requests from
// other sites, and they cannot send a JSON body to another site without a
// CORS check, which this endpoint never approves.
$origin = $_SERVER['HTTP_ORIGIN'] ?? null;
$host = (string) ($_SERVER['HTTP_HOST'] ?? '');
if ($origin !== null && $origin !== 'http://' . $host && $origin !== 'https://' . $host) {
    respondJson(403, ['error' => 'Saving is only allowed from this page.']);
}
if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
    respondJson(415, ['error' => 'The data must be sent as JSON.']);
}

$maxBytes = 65_536;
$body = (string) file_get_contents('php://input', false, null, 0, $maxBytes + 1);
if (strlen($body) > $maxBytes) {
    respondJson(413, ['error' => 'The data is too large to save.']);
}

try {
    $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    respondJson(400, ['error' => 'The data is not valid JSON.']);
}

$portfolio = normalizePortfolio($data);
if ($portfolio === null) {
    respondJson(400, ['error' => 'The stock list contains an invalid ticker or section, or more than ' . PORTFOLIO_MAX_STOCKS . ' stocks.']);
}

if (!savePortfolio(portfolioPath(), $portfolio)) {
    error_log('Stock Panel data endpoint: could not write ' . portfolioPath());
    respondJson(500, ['error' => 'The data file could not be written.']);
}

respondJson(200, ['savedAt' => gmdate(DATE_ATOM)]);
