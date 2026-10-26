<?php

namespace Tests;

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
    }
}
