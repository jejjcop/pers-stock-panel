<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;
use StockPanel\StockPanel;

/**
 * The main page: your stock lists, built from data/portfolio.json.
 */
class DashboardController extends Controller
{
    public function __invoke(): View|RedirectResponse
    {
        // For now the login is still checked by the old code in src/auth.php.
        // Step 2 replaces this with Laravel's own login and middleware.
        if (!isLoggedIn()) {
            return redirect('login.php', 303);
        }
        session_write_close();

        $portfolioPath = portfolioPath();
        $portfolio = loadPortfolio($portfolioPath);
        $isNewPortfolio = $portfolio === null;
        if ($isNewPortfolio && is_file($portfolioPath)) {
            // Keep a damaged file instead of overwriting it with the starting stocks.
            @rename($portfolioPath, $portfolioPath . '.invalid-' . date('Ymd-His'));
        }
        $portfolio ??= defaultPortfolio();

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
