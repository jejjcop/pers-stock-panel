<?php

namespace App\Services;

use Anthropic\Client;
use App\Models\User;

/**
 * Answers questions about the user's stocks with Claude, Anthropic's AI.
 *
 * Claude gets three tools: the user's stock lists with current prices (from
 * QuoteBoard), a stock's price history (from Yahoo Finance), and Anthropic's
 * web search for news. Claude decides which to use; this class runs the
 * first two when asked and sends the results back, until Claude answers.
 */
class StockAssistant
{
    public const MODEL = 'claude-opus-5-5';
    // Rounds of tool use allowed for one question, so a confused answer
    // cannot keep calling tools (and costing money) forever.
    private const MAX_ROUNDS = 10;
    private const MAX_SEARCHES = 5;

    public function __construct(
        private Client $claude,
        private QuoteBoard $board,
        private YahooFinance $yahoo,
    ) {
    }

    /** Whether an API key is set up in .env. */
    public static function isConfigured(): bool
    {
        return (string) config('services.anthropic.key') !== '';
    }

    /**
     * Asks Claude one question, continuing a conversation.
     *
     * @param list<array<string, mixed>> $messages the conversation so far, as
     *     the API takes it (what an earlier ask() returned)
     * @return array{answer: string, sources: list<array{url: string, title: string}>, messages: list<array<string, mixed>>}
     *     the answer, the web pages it cites, and the conversation including it.
     *     When Claude declines to answer, the conversation is left as it was.
     */
    public function ask(User $user, array $messages, string $question): array
    {
        $before = $messages;
        $messages[] = ['role' => 'user', 'content' => $question];
        $firstReply = count($messages);

        for ($round = 0; $round < self::MAX_ROUNDS; $round++) {
            $response = $this->claude->beta->messages->create(
                model: self::MODEL,
                maxTokens: 16000,
                system: $this->instructions(),
                messages: $messages,
                tools: $this->tools(),
                outputConfig: ['effort' => 'low'],
                // Each request repeats the conversation so far; cached, the
                // repeated part costs a tenth.
                cacheControl: ['type' => 'ephemeral'],
                // If Claude's safety checks decline a question, Anthropic
                // retries it on another model chosen for that case.
                fallbacks: 'default',
                betas: ['server-side-fallback-2026-07-01'],
            );
            // Saved as plain arrays (the API's own JSON), and sent back
            // unchanged next time, which Claude requires.
            $messages[] = ['role' => 'assistant', 'content' => json_decode(json_encode($response->content), true)];

            if ($response->stopReason === 'refusal') {
                return ['answer' => 'Claude declined to answer that question.', 'sources' => [], 'messages' => $before];
            }
            if ($response->stopReason === 'tool_use') {
                $messages[] = ['role' => 'user', 'content' => $this->runTools($user, $response->content)];
                continue;
            }
            if ($response->stopReason === 'pause_turn') {
                continue;  // a long web search paused; sending it back resumes it
            }

            return [...$this->answerIn(array_slice($messages, $firstReply)), 'messages' => $messages];
        }

        return ['answer' => 'Claude needed too many steps for this question. Try asking it in a simpler way.', 'sources' => [], 'messages' => $before];
    }

    private function instructions(): string
    {
        return <<<TEXT
            You are the assistant in a personal stock dashboard. Its owner, who lives in Sweden, asks you about their stocks: "My current stocks" are the ones they own, with the number of shares and the average price they paid; "Stocks to monitor" are ones they are watching.

            Use the tools for facts: get_my_stocks for their lists, holdings and current prices, get_price_history for how a price has moved, and web search for news and company information. Never guess prices or numbers. The prices come from Yahoo Finance and can be a little delayed.

            Answer in the language of the question (often Swedish). Be brief and concrete. Write plain text without Markdown: short paragraphs, and lists with "- " when they help. When something is an opinion or uncertain, say so; the owner makes their own decisions.

            Today is {$this->today()}.
            TEXT;
    }

    // Only the day: a time would change the instructions every minute, and
    // the cache only reuses what is unchanged. get_my_stocks tells Claude
    // whether the market is open.
    private function today(): string
    {
        return now('Europe/Stockholm')->format('l j F Y');
    }

    /** The tools Claude may use, in the API's form. */
    private function tools(): array
    {
        return [
            [
                'name' => 'get_my_stocks',
                'description' => "The owner's stock lists with current prices: for each stock its list (owned or monitor), "
                    . 'shares and average cost when owned, name, price, currency, change today, this week and this month in percent, '
                    . 'and pre-market or after-hours prices; plus exchange rates to Swedish kronor.',
                'inputSchema' => ['type' => 'object', 'properties' => (object) [], 'additionalProperties' => false],
            ],
            [
                'name' => 'get_price_history',
                'description' => 'Closing prices of one stock over a period, oldest first: 1d (every 5 minutes today), '
                    . '1w (every 30 minutes), 1m (hourly), 1y (daily) or 5y (weekly). Times are UTC.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'symbol' => ['type' => 'string', 'description' => 'Yahoo Finance ticker, e.g. NVDA or VOLV-B.ST'],
                        'range' => ['type' => 'string', 'enum' => array_keys(HISTORY_RANGES)],
                    ],
                    'required' => ['symbol', 'range'],
                    'additionalProperties' => false,
                ],
                'strict' => true,
            ],
            ['type' => 'web_search_20260209', 'name' => 'web_search', 'maxUses' => self::MAX_SEARCHES],
        ];
    }

    /**
     * Runs the tools Claude asked for (web search runs at Anthropic) and
     * returns their results, all in one message as the API wants.
     */
    private function runTools(User $user, array $content): array
    {
        $results = [];
        foreach ($content as $block) {
            if ($block->type !== 'tool_use') {
                continue;
            }
            $input = is_array($block->input) ? $block->input : [];
            $output = match ($block->name) {
                'get_my_stocks' => $this->myStocks($user),
                'get_price_history' => $this->priceHistory((string) ($input['symbol'] ?? ''), (string) ($input['range'] ?? '')),
                default => ['error' => "There is no tool called {$block->name}."],
            };
            $results[] = [
                'type' => 'tool_result',
                'tool_use_id' => $block->id,
                'content' => json_encode($output, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
                'is_error' => isset($output['error']),
            ];
        }

        return $results;
    }

    private function myStocks(User $user): array
    {
        $portfolio = $user->portfolio();
        $tickers = array_column($portfolio['stocks'], 'ticker');
        $board = $tickers === [] ? ['quotes' => [], 'extendedQuotes' => [], 'fxRates' => [], 'errors' => [], 'market' => null] : $this->board->build($tickers, time());

        $stocks = [];
        foreach ($portfolio['stocks'] as $stock) {
            $ticker = $stock['ticker'];
            $quote = $board['quotes'][$ticker] ?? null;
            $extended = $board['extendedQuotes'][$ticker] ?? [];
            $holding = $portfolio['holdings'][$ticker] ?? null;
            $stocks[] = array_filter([
                'ticker' => $ticker,
                'list' => $stock['list'],
                'shares' => $holding['shares'] ?? null,
                'averageCost' => $holding['cost'] ?? null,
                'name' => $quote['name'] ?? null,
                'price' => $quote['price'] ?? null,
                'currency' => $quote['currency'] ?? null,
                'changeTodayPct' => self::rounded($quote['changePct'] ?? null),
                'changeWeekPct' => self::rounded($quote['weekChangePct'] ?? null),
                'changeMonthPct' => self::rounded($quote['monthChangePct'] ?? null),
                'previousClose' => $quote['previousClose'] ?? null,
                'preMarket' => $extended['preMarket'] ?? null,
                'afterHours' => $extended['afterHours'] ?? null,
                'error' => $board['errors'][$ticker] ?? null,
            ], static fn ($value): bool => $value !== null);
        }

        return [
            'stocks' => $stocks,
            'sekPerCurrencyUnit' => (array) $board['fxRates'],
            'market' => $board['market'],
        ];
    }

    private function priceHistory(string $symbol, string $range): array
    {
        $symbol = strtoupper(trim($symbol));
        if (preg_match(TICKER_PATTERN, $symbol) !== 1) {
            return ['error' => 'That is not a valid ticker.'];
        }
        if (!isset(HISTORY_RANGES[$range])) {
            return ['error' => 'Choose one of the periods ' . implode(', ', array_keys(HISTORY_RANGES)) . '.'];
        }

        $settings = HISTORY_RANGES[$range];
        $chart = $this->yahoo->charts(['chart' => [
            'symbol' => $symbol,
            'query' => ['range' => $settings['range'], 'interval' => $settings['interval']],
            'cacheSeconds' => $settings['cacheSeconds'],
        ]])['chart'];
        if ($chart->result === null) {
            return ['error' => $chart->error ?? 'Yahoo Finance had no prices for that stock.'];
        }

        $format = in_array($range, ['1y', '5y'], true) ? 'Y-m-d' : 'Y-m-d H:i';

        return [
            'symbol' => $symbol,
            'currency' => (string) ($chart->result['meta']['currency'] ?? 'USD'),
            'closes' => array_map(
                static fn (array $point): array => [gmdate($format, (int) $point[0]), $point[1]],
                historyPoints($chart->result)
            ),
        ];
    }

    /**
     * The answer's text, and the web pages it cites, from Claude's replies
     * to one question.
     *
     * @param list<array<string, mixed>> $replies
     * @return array{answer: string, sources: list<array{url: string, title: string}>}
     */
    private function answerIn(array $replies): array
    {
        $text = '';
        $sources = [];
        foreach ($replies as $message) {
            if ($message['role'] !== 'assistant') {
                continue;
            }
            foreach ($message['content'] as $block) {
                if (($block['type'] ?? '') !== 'text') {
                    continue;
                }
                $text .= $block['text'];
                foreach ($block['citations'] ?? [] as $citation) {
                    if (isset($citation['url']) && !isset($sources[$citation['url']])) {
                        $sources[$citation['url']] = ['url' => $citation['url'], 'title' => (string) ($citation['title'] ?? $citation['url'])];
                    }
                }
            }
        }

        return ['answer' => trim($text), 'sources' => array_values($sources)];
    }

    private static function rounded(mixed $value): ?float
    {
        return is_numeric($value) ? round((float) $value, 2) : null;
    }
}
