<?php

namespace Tests;

use Anthropic\Client;
use GuzzleHttp\Client as Guzzle;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;

/**
 * Made-up answers from Claude, so tests never contact Anthropic (or spend
 * money): Anthropic's client is given a connection that answers each request
 * with the next reply from a list, and keeps the requests for checking.
 */
trait FakesClaude
{
    /** @var list<array{request: \Psr\Http\Message\RequestInterface}> */
    private array $claudeRequests = [];

    /**
     * @param list<array|Response> $replies a reply() each, or a whole HTTP
     *     response (e.g. an error)
     */
    protected function fakeClaude(array $replies): void
    {
        config(['services.anthropic.key' => 'test-key']);
        $this->claudeRequests = [];

        $handler = HandlerStack::create(new MockHandler(array_map(
            static fn (array|Response $reply): Response => $reply instanceof Response
                ? $reply
                : new Response(200, ['Content-Type' => 'application/json'], json_encode($reply)),
            $replies
        )));
        $handler->push(Middleware::history($this->claudeRequests));

        $this->app->instance(Client::class, new Client(
            apiKey: 'test-key',
            requestOptions: ['transporter' => new Guzzle(['handler' => $handler]), 'maxRetries' => 0],
        ));
    }

    /** A reply from Claude with these content blocks. */
    protected function reply(array $content, string $stopReason = 'end_turn'): array
    {
        return [
            'id' => 'msg_' . count($content),
            'type' => 'message',
            'role' => 'assistant',
            'model' => 'claude-opus-5-5',
            'content' => $content,
            'stop_reason' => $stopReason,
            'stop_sequence' => null,
            'usage' => ['input_tokens' => 100, 'output_tokens' => 20],
        ];
    }

    protected function text(string $text, array $citations = []): array
    {
        return ['type' => 'text', 'text' => $text] + ($citations === [] ? [] : ['citations' => $citations]);
    }

    protected function toolUse(string $id, string $name, array $input = []): array
    {
        return ['type' => 'tool_use', 'id' => $id, 'name' => $name, 'input' => (object) $input];
    }

    /** An error answer from Anthropic, e.g. 401 authentication_error. */
    protected function claudeError(int $status, string $type): Response
    {
        return new Response($status, ['Content-Type' => 'application/json'], json_encode([
            'type' => 'error',
            'error' => ['type' => $type, 'message' => 'Made-up error'],
        ]));
    }

    /** The body of the nth request sent to Claude (from 0), decoded. */
    protected function claudeRequest(int $n): array
    {
        return json_decode((string) $this->claudeRequests[$n]['request']->getBody(), true);
    }

    protected function claudeRequestCount(): int
    {
        return count($this->claudeRequests);
    }
}
