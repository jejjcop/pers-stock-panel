<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use JsonException;

/**
 * Saves the page's stock lists and holdings to the database.
 *
 * Only the page itself can save: Laravel refuses POST requests from other
 * sites (its CSRF protection) before this code runs.
 */
class PortfolioController extends Controller
{
    private const MAX_BYTES = 65_536;

    public function store(Request $request): JsonResponse
    {
        if (!$request->isJson()) {
            return $this->respond(415, ['error' => 'The data must be sent as JSON.']);
        }

        $body = $request->getContent();
        if (strlen($body) > self::MAX_BYTES) {
            return $this->respond(413, ['error' => 'The data is too large to save.']);
        }

        try {
            $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return $this->respond(400, ['error' => 'The data is not valid JSON.']);
        }

        $portfolio = normalizePortfolio($data);
        if ($portfolio === null) {
            return $this->respond(400, ['error' => 'The stock list contains an invalid ticker or section, or more than ' . PORTFOLIO_MAX_STOCKS . ' stocks.']);
        }

        $request->user()->savePortfolio($portfolio);

        return $this->respond(200, ['savedAt' => gmdate(DATE_ATOM)]);
    }

    private function respond(int $status, array $payload): JsonResponse
    {
        return response()->json($payload, $status, ['Cache-Control' => 'no-store']);
    }
}
