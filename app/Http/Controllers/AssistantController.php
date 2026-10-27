<?php

namespace App\Http\Controllers;

use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\PermissionDeniedException;
use Anthropic\Core\Exceptions\RateLimitException;
use App\Services\StockAssistant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * The "Ask about my stocks" box (/assistant): the conversation so far, a new
 * question, and starting over.
 *
 * The conversation is kept in Laravel's cache for a day, rather than in the
 * session: with web searches it can grow large, and the session is read on
 * every request the page makes.
 */
class AssistantController extends Controller
{
    private const KEEP_SECONDS = 86400;
    private const MAX_QUESTION_LENGTH = 2000;

    /** The conversation so far, as the page shows it. */
    public function show(Request $request): JsonResponse
    {
        return $this->respond(200, [
            'available' => StockAssistant::isConfigured(),
            'transcript' => $this->conversation($request)['transcript'],
        ]);
    }

    public function store(Request $request, StockAssistant $assistant): JsonResponse
    {
        $question = trim((string) $request->input('question', ''));
        if ($question === '' || mb_strlen($question) > self::MAX_QUESTION_LENGTH) {
            return $this->respond(422, ['error' => 'Write a question of up to ' . self::MAX_QUESTION_LENGTH . ' characters.']);
        }
        if (!StockAssistant::isConfigured()) {
            return $this->respond(503, ['error' => 'No API key is set up. Add ANTHROPIC_API_KEY to the .env file (see the README).']);
        }

        // An answer with web searches can take a minute or more.
        set_time_limit(300);
        $conversation = $this->conversation($request);
        try {
            $result = $assistant->ask($request->user(), $conversation['messages'], $question);
        } catch (AuthenticationException|PermissionDeniedException) {
            return $this->respond(502, ['error' => 'Anthropic did not accept the API key. Check ANTHROPIC_API_KEY in the .env file.']);
        } catch (RateLimitException) {
            return $this->respond(429, ['error' => 'Too many questions in a short time, or the credit at Anthropic has run out. Try again in a minute.']);
        } catch (APIConnectionException) {
            return $this->respond(502, ['error' => 'Could not reach Anthropic. Check the internet connection and try again.']);
        } catch (APIStatusException $error) {
            Log::warning('Claude could not answer: ' . $error->getMessage());

            return $this->respond(502, ['error' => 'Claude could not answer just now (' . ($error->type?->value ?? 'error ' . $error->status) . '). Try again in a moment.']);
        }

        $conversation['messages'] = $result['messages'];
        $conversation['transcript'][] = ['role' => 'user', 'text' => $question];
        $conversation['transcript'][] = ['role' => 'assistant', 'text' => $result['answer'], 'sources' => $result['sources']];
        Cache::put($this->cacheKey($request), $conversation, self::KEEP_SECONDS);

        return $this->respond(200, ['answer' => $result['answer'], 'sources' => $result['sources']]);
    }

    /** Starts a new conversation. */
    public function destroy(Request $request): JsonResponse
    {
        Cache::forget($this->cacheKey($request));

        return $this->respond(200, ['transcript' => []]);
    }

    /**
     * @return array{messages: list<array<string, mixed>>, transcript: list<array<string, mixed>>}
     */
    private function conversation(Request $request): array
    {
        return Cache::get($this->cacheKey($request), ['messages' => [], 'transcript' => []]);
    }

    private function cacheKey(Request $request): string
    {
        return 'assistant:' . $request->user()->id;
    }

    private function respond(int $status, array $payload): JsonResponse
    {
        return response()->json($payload, $status, ['Cache-Control' => 'no-store'], JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
