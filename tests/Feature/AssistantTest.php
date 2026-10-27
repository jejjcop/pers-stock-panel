<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\FakesClaude;
use Tests\FakesYahoo;
use Tests\TestCase;

/**
 * The "Ask about my stocks" box (/assistant), with made-up answers from
 * Claude (see FakesClaude) and Yahoo Finance (see FakesYahoo).
 */
class AssistantTest extends TestCase
{
    use FakesClaude;
    use FakesYahoo;
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->user->savePortfolio([
            'stocks' => [['ticker' => 'MU', 'list' => 'owned'], ['ticker' => 'NVDA', 'list' => 'monitor']],
            'holdings' => ['MU' => ['shares' => 19.0, 'cost' => 989.5]],
        ]);
        $this->actingAs($this->user);
    }

    private function ask(string $question): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/assistant', ['question' => $question]);
    }

    public function testGivesNothingAwayWithoutALogin(): void
    {
        auth()->logout();

        $this->getJson('/assistant')->assertStatus(401);
        $this->postJson('/assistant', ['question' => 'Hi'])->assertStatus(401);
        $this->deleteJson('/assistant')->assertStatus(401);
    }

    public function testSaysWhenNoApiKeyIsSetUp(): void
    {
        $this->getJson('/assistant')->assertOk()->assertExactJson(['available' => false, 'transcript' => []]);
        $this->ask('How are my stocks doing?')->assertStatus(503)
            ->assertJson(['error' => 'No API key is set up. Add ANTHROPIC_API_KEY to the .env file (see the README).']);
    }

    public function testTheAppsClientUsesTheKeyFromTheSettings(): void
    {
        config(['services.anthropic.key' => 'key-from-env']);
        // Forget the test's client, so Laravel makes the app's own.
        $this->app->forgetInstance(\Anthropic\Client::class);

        $this->assertSame('key-from-env', app(\Anthropic\Client::class)->apiKey);
    }

    public function testRefusesAnEmptyOrVeryLongQuestion(): void
    {
        $this->fakeClaude([]);

        $this->ask('   ')->assertStatus(422);
        $this->ask(str_repeat('a', 2001))->assertStatus(422);
        $this->assertSame(0, $this->claudeRequestCount());
    }

    public function testAnswersAQuestion(): void
    {
        $this->fakeClaude([$this->reply([$this->text('Hej! Your stocks are doing fine.')])]);

        $this->ask('Hur går det?')->assertOk()->assertExactJson(['answer' => 'Hej! Your stocks are doing fine.', 'sources' => []]);

        $request = $this->claudeRequest(0);
        $this->assertSame('claude-opus-5-5', $request['model']);
        $this->assertSame([['role' => 'user', 'content' => 'Hur går det?']], $request['messages']);
        $this->assertSame(['effort' => 'low'], $request['output_config']);
        $this->assertSame('default', $request['fallbacks']);
        $this->assertSame(['type' => 'ephemeral'], $request['cache_control']);
        $this->assertSame('server-side-fallback-2026-07-01', $this->claudeRequests[0]['request']->getHeaderLine('anthropic-beta'));
        $this->assertStringContainsString('Answer in the language of the question', $request['system']);
        $this->assertSame(['get_my_stocks', 'get_price_history', 'web_search'], array_column($request['tools'], 'name'));
        $this->assertSame(['type' => 'web_search_20260209', 'name' => 'web_search', 'max_uses' => 5], $request['tools'][2]);
    }

    public function testToolSchemasAreValidJsonSchema(): void
    {
        $this->fakeClaude([$this->reply([$this->text('Ok')])]);
        $this->ask('Hi');

        $body = (string) $this->claudeRequests[0]['request']->getBody();
        // An object, not an empty list, as JSON Schema requires.
        $this->assertStringContainsString('"input_schema":{"type":"object","properties":{},"additionalProperties":false}', $body);
        $history = $this->claudeRequest(0)['tools'][1];
        $this->assertTrue($history['strict']);
        $this->assertSame(['1d', '1w', '1m', '1y', '5y'], $history['input_schema']['properties']['range']['enum']);
    }

    public function testGivesClaudeTheStocksWithCurrentPrices(): void
    {
        $this->fakeYahooForMu();
        $thinking = ['type' => 'thinking', 'thinking' => '', 'signature' => 'made-up-signature'];
        $this->fakeClaude([
            $this->reply([$thinking, $this->toolUse('toolu_1', 'get_my_stocks')], 'tool_use'),
            $this->reply([$this->text('MU is up 4.06% today.')]),
        ]);

        $this->ask('How is MU doing today?')->assertOk()->assertJson(['answer' => 'MU is up 4.06% today.']);

        $messages = $this->claudeRequest(1)['messages'];
        $this->assertCount(3, $messages);
        // Claude's own reply goes back unchanged, with its thinking block.
        $this->assertSame('assistant', $messages[1]['role']);
        $this->assertEquals($thinking, $messages[1]['content'][0]);
        $this->assertSame(['type' => 'tool_use', 'id' => 'toolu_1', 'input' => [], 'name' => 'get_my_stocks'], $messages[1]['content'][1]);

        $result = $messages[2]['content'][0];
        $this->assertSame('tool_result', $result['type']);
        $this->assertSame('toolu_1', $result['tool_use_id']);
        $this->assertFalse($result['is_error']);
        $data = json_decode($result['content'], true);
        $this->assertSame([
            'ticker' => 'MU',
            'list' => 'owned',
            'shares' => 19,
            'averageCost' => 989.5,
            'name' => 'Micron Technology, Inc.',
            'price' => 1088,
            'currency' => 'USD',
            'changeTodayPct' => 4.06,
            'changeWeekPct' => 6.67,
            'previousClose' => 1045.56,
            'preMarket' => ['price' => 1050, 'time' => nyTime('2026-10-21 09:00')],
        ], $data['stocks'][0]);
        // Yahoo had nothing for NVDA in this test.
        $this->assertSame('monitor', $data['stocks'][1]['list']);
        $this->assertArrayHasKey('error', $data['stocks'][1]);
        $this->assertSame(['USD' => 10.5], $data['sekPerCurrencyUnit']);
    }

    public function testGivesClaudeAPriceHistory(): void
    {
        $this->fakeYahoo(['MU 1d' => $this->chart(
            ['currency' => 'USD'],
            [nyTime('2026-10-19 09:30'), nyTime('2026-10-20 09:30')],
            [1000, 1045.56]
        )]);
        $this->fakeClaude([
            $this->reply([$this->toolUse('toolu_1', 'get_price_history', ['symbol' => 'mu', 'range' => '1y'])], 'tool_use'),
            $this->reply([$this->text('It rose.')]),
        ]);

        $this->ask('How has MU done this year?')->assertOk();

        $result = $this->claudeRequest(1)['messages'][2]['content'][0];
        $this->assertSame(
            ['symbol' => 'MU', 'currency' => 'USD', 'closes' => [['2026-10-19', 1000], ['2026-10-20', 1045.56]]],
            json_decode($result['content'], true)
        );
    }

    public function testTellsClaudeWhenAToolIsAskedForSomethingInvalid(): void
    {
        $this->fakeClaude([
            $this->reply([
                $this->toolUse('toolu_1', 'get_price_history', ['symbol' => '<b>', 'range' => '1y']),
                $this->toolUse('toolu_2', 'delete_everything'),
            ], 'tool_use'),
            $this->reply([$this->text('Sorry.')]),
        ]);

        $this->ask('Hi')->assertOk();

        // Both results in one message, as the API wants.
        [$first, $second] = $this->claudeRequest(1)['messages'][2]['content'];
        $this->assertTrue($first['is_error']);
        $this->assertSame('{"error":"That is not a valid ticker."}', $first['content']);
        $this->assertSame('toolu_2', $second['tool_use_id']);
        $this->assertTrue($second['is_error']);
    }

    public function testContinuesTheConversation(): void
    {
        $this->fakeClaude([
            $this->reply([$this->text('First answer.')]),
            $this->reply([$this->text('Second answer.')]),
        ]);

        $this->ask('First question')->assertOk();
        $this->ask('Second question')->assertOk();

        $this->assertSame([
            ['role' => 'user', 'content' => 'First question'],
            ['role' => 'assistant', 'content' => [['type' => 'text', 'text' => 'First answer.']]],
            ['role' => 'user', 'content' => 'Second question'],
        ], $this->claudeRequest(1)['messages']);
        $this->getJson('/assistant')->assertOk()->assertExactJson(['available' => true, 'transcript' => [
            ['role' => 'user', 'text' => 'First question'],
            ['role' => 'assistant', 'text' => 'First answer.', 'sources' => []],
            ['role' => 'user', 'text' => 'Second question'],
            ['role' => 'assistant', 'text' => 'Second answer.', 'sources' => []],
        ]]);
    }

    public function testStartsANewConversation(): void
    {
        $this->fakeClaude([
            $this->reply([$this->text('First answer.')]),
            $this->reply([$this->text('Fresh answer.')]),
        ]);
        $this->ask('First question')->assertOk();

        $this->deleteJson('/assistant')->assertOk()->assertExactJson(['transcript' => []]);

        $this->getJson('/assistant')->assertJson(['transcript' => []]);
        $this->ask('New question')->assertOk();
        $this->assertSame([['role' => 'user', 'content' => 'New question']], $this->claudeRequest(1)['messages']);
    }

    public function testListsTheWebPagesTheAnswerCites(): void
    {
        $citation = ['type' => 'web_search_result_location', 'url' => 'https://example.com/news', 'title' => 'Chip news', 'cited_text' => 'Up', 'encrypted_index' => 'x'];
        $this->fakeClaude([$this->reply([
            $this->text('Micron rose '),
            $this->text('after strong results.', [$citation]),
            $this->text(' More here.', [$citation]),
        ])]);

        $this->ask('Why did MU rise?')->assertOk()->assertExactJson([
            'answer' => 'Micron rose after strong results. More here.',
            'sources' => [['url' => 'https://example.com/news', 'title' => 'Chip news']],
        ]);
    }

    public function testLeavesTheConversationAsItWasWhenClaudeDeclines(): void
    {
        $this->fakeClaude([
            $this->reply([$this->text('Answer.')]),
            $this->reply([], 'refusal'),
            $this->reply([$this->text('Next.')]),
        ]);
        $this->ask('First')->assertOk();

        $this->ask('Something declined')->assertOk()->assertJson(['answer' => 'Claude declined to answer that question.']);

        $this->ask('Next')->assertOk();
        $this->assertSame(['First', 'Next'], array_column(
            array_filter($this->claudeRequest(2)['messages'], static fn (array $m): bool => $m['role'] === 'user'),
            'content'
        ));
    }

    public function testStopsAfterTooManyRounds(): void
    {
        $this->fakeClaude(array_fill(0, 11, $this->reply([$this->toolUse('toolu_1', 'get_price_history', ['symbol' => '<b>', 'range' => '1y'])], 'tool_use')));

        $this->ask('Loop forever')->assertOk()
            ->assertJson(['answer' => 'Claude needed too many steps for this question. Try asking it in a simpler way.']);
        $this->assertSame(10, $this->claudeRequestCount());
    }

    public function testExplainsWhenAnthropicRefusesTheKey(): void
    {
        $this->fakeClaude([$this->claudeError(401, 'authentication_error')]);

        $this->ask('Hi')->assertStatus(502)
            ->assertJson(['error' => 'Anthropic did not accept the API key. Check ANTHROPIC_API_KEY in the .env file.']);
        $this->getJson('/assistant')->assertJson(['transcript' => []]);
    }

    public function testExplainsWhenAnthropicIsBusy(): void
    {
        $this->fakeClaude([$this->claudeError(529, 'overloaded_error')]);

        $this->ask('Hi')->assertStatus(502)
            ->assertJson(['error' => 'Claude could not answer just now (overloaded_error). Try again in a moment.']);
    }
}
