<?php

namespace Tests;

use Anthropic\Client;
use GuzzleHttp\Client as Guzzle;
use GuzzleHttp\Handler\MockHandler;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;

/**
 * The base of the Laravel (Feature) tests.
 */
abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // No test may contact the real Yahoo Finance: a request that
        // Http::fake() does not answer fails the test.
        Http::preventStrayRequests();

        // Nor Anthropic, even with a real key in .env: there is no key, and
        // a request without FakesClaude's answers fails the test.
        config(['services.anthropic.key' => null]);
        $this->app->instance(Client::class, new Client(
            apiKey: 'no-key-in-tests',
            requestOptions: ['transporter' => new Guzzle(['handler' => new MockHandler()]), 'maxRetries' => 0],
        ));
    }
}
