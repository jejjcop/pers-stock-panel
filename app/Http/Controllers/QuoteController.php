<?php

namespace App\Http\Controllers;

use App\Services\QuoteBoard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Prices for the stocks on the page (/quotes?symbols=MU,NVDA). The work is
 * done by the QuoteBoard service, which Laravel hands to this method.
 */
class QuoteController extends Controller
{
    public function __invoke(Request $request, QuoteBoard $board): JsonResponse
    {
        $symbols = array_values(array_unique(array_filter(
            array_map('strtoupper', array_map('trim', explode(',', (string) $request->query('symbols', '')))),
            static fn (string $symbol): bool => $symbol !== ''
        )));

        if ($symbols === [] || count($symbols) > 25) {
            return $this->respond(400, ['error' => 'Provide between 1 and 25 stock symbols.']);
        }
        foreach ($symbols as $symbol) {
            if (preg_match(TICKER_PATTERN, $symbol) !== 1) {
                return $this->respond(400, ['error' => 'One or more stock symbols have an invalid format.']);
            }
        }

        return $this->respond(200, $board->build($symbols, time()));
    }

    private function respond(int $status, array $payload): JsonResponse
    {
        return response()->json($payload, $status, ['Cache-Control' => 'no-store'], JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
