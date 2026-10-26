<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\View\View;
use StockPanel\StockPanel;

/**
 * The main page: your stock lists, from the database.
 */
class DashboardController extends Controller
{
    // Only reached when logged in: the route's 'logged.in' middleware checks.
    public function __invoke(Request $request): View
    {
        // The logged-in user, as a User model.
        $user = $request->user();
        $portfolio = $user->portfolio();
        // Nothing saved yet: the page starts with the built-in stocks.
        $isNewPortfolio = $user->portfolio_saved_at === null;

        // Names are known up front only for the built-in stocks; the others get
        // theirs with the first price refresh.
        $knownNames = array_column(StockPanel::watchlist(), 'name', 'ticker');

        $sections = [
            'owned' => [
                'eyebrow' => 'Portfolio',
                'title' => 'My current stocks',
                'empty' => 'No stocks here yet. Add a ticker above and choose "My current stocks".',
            ],
            'monitor' => [
                'eyebrow' => 'Watchlist',
                'title' => 'Stocks to monitor',
                'empty' => 'No stocks here yet. Add a ticker above and choose "Stocks to monitor".',
            ],
        ];
        foreach ($sections as $list => $section) {
            $sections[$list]['stocks'] = array_values(array_filter(
                $portfolio['stocks'],
                static fn (array $stock): bool => $stock['list'] === $list
            ));
        }

        // Handed to public/app.js, which builds the table rows from it.
        $pageData = [
            'isNew' => $isNewPortfolio,
            'stocks' => array_map(
                static fn (array $stock): array => $stock + ['name' => $knownNames[$stock['ticker']] ?? null],
                $portfolio['stocks']
            ),
            'holdings' => (object) $portfolio['holdings'],
        ];

        return view('dashboard', [
            'sections' => $sections,
            'pageData' => $pageData,
        ]);
    }
}
