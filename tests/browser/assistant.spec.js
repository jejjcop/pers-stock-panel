// @ts-check
const { test, expect, writePortfolio } = require('./helpers');

/**
 * Answers the page's /assistant requests in the app's place, so no test asks
 * the real Claude. `answer` is what a question gets: a reply, or
 * { status, error }. Returns the questions asked and the clears.
 */
async function stubAssistant(page, { available = true, transcript = [], answer = { answer: 'Fine.', sources: [] }, delayMs = 0 } = {}) {
    const calls = { questions: /** @type {string[]} */ ([]), clears: 0 };
    await page.route('**/assistant', async (route) => {
        const request = route.request();
        if (request.method() === 'GET') {
            return route.fulfill({ json: { available, transcript } });
        }
        if (request.method() === 'DELETE') {
            calls.clears += 1;
            return route.fulfill({ json: { transcript: [] } });
        }
        calls.questions.push(request.postDataJSON().question);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if ('error' in answer) {
            return route.fulfill({ status: answer.status, json: { error: answer.error } });
        }
        return route.fulfill({ json: answer });
    });
    return calls;
}

test.describe('asking Claude', () => {
    test.beforeEach(() => {
        writePortfolio({ stocks: [{ ticker: 'MU', list: 'owned' }] });
    });

    test('asks a question and shows the answer with its sources', async ({ page }) => {
        const calls = await stubAssistant(page, {
            delayMs: 1500,
            answer: {
                answer: 'Micron rose after strong results.\n\n- Revenue beat estimates',
                sources: [{ url: 'https://example.com/news', title: 'Chip news' }],
            },
        });
        await page.goto('/');

        await page.getByLabel('Question').fill('Why did MU rise?');
        await page.getByRole('button', { name: 'Ask' }).click();

        // The question shows at once, and the button waits for the answer.
        await expect(page.locator('.assistant-message.is-user')).toHaveText('YouWhy did MU rise?');
        await expect(page.locator('#assistant-status')).toHaveText(/^Claude is thinking/);
        await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
        await expect(page.getByLabel('Question')).toHaveValue('');

        const answer = page.locator('.assistant-message.is-assistant');
        await expect(answer.locator('.assistant-message-text')).toHaveText('Micron rose after strong results.\n\n- Revenue beat estimates');
        const link = answer.getByRole('link', { name: 'Chip news' });
        await expect(link).toHaveAttribute('href', 'https://example.com/news');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(page.getByRole('button', { name: 'Ask' })).toBeEnabled();
        await expect(page.locator('#assistant-status')).toHaveText('');
        expect(calls.questions).toEqual(['Why did MU rise?']);
    });

    test('sends with Enter, and Shift+Enter starts a new line', async ({ page }) => {
        const calls = await stubAssistant(page);
        await page.goto('/');

        const box = page.getByLabel('Question');
        await box.click();
        await box.pressSequentially('First line');
        await box.press('Shift+Enter');
        await box.pressSequentially('second line');
        await box.press('Enter');

        await expect(page.locator('.assistant-message.is-assistant')).toHaveText('ClaudeFine.');
        expect(calls.questions).toEqual(['First line\nsecond line']);
    });

    test('shows the conversation so far, and starts a new one', async ({ page }) => {
        const calls = await stubAssistant(page, {
            transcript: [
                { role: 'user', text: 'Earlier question' },
                { role: 'assistant', text: 'Earlier answer', sources: [] },
            ],
        });
        await page.goto('/');

        await expect(page.locator('.assistant-message')).toHaveText(['YouEarlier question', 'ClaudeEarlier answer']);

        await page.getByRole('button', { name: 'New conversation' }).click();

        await expect(page.locator('.assistant-message')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'New conversation' })).toBeHidden();
        expect(calls.clears).toBe(1);
    });

    test('shows answers as text, never as HTML or unsafe links', async ({ page }) => {
        await stubAssistant(page, {
            answer: {
                answer: '<img src=x onerror="document.title=\'hacked\'"> <b>not bold</b>',
                sources: [{ url: 'javascript:alert(1)', title: 'Bad link' }],
            },
        });
        await page.goto('/');

        await page.getByLabel('Question').fill('Hi');
        await page.getByRole('button', { name: 'Ask' }).click();

        const answer = page.locator('.assistant-message.is-assistant .assistant-message-text');
        await expect(answer).toHaveText('<img src=x onerror="document.title=\'hacked\'"> <b>not bold</b>');
        await expect(page.locator('.assistant-message img, .assistant-message b')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Bad link' })).toHaveCount(0);
        await expect(page).toHaveTitle('Pers Stock Panel');
    });

    test.describe('when Claude cannot answer', () => {
        test.use({ expectedConsoleErrors: [/502/] });

        test('explains why and gives the question back', async ({ page }) => {
            await stubAssistant(page, { answer: { status: 502, error: 'Anthropic did not accept the API key.' } });
            await page.goto('/');

            await page.getByLabel('Question').fill('How are my stocks?');
            await page.getByRole('button', { name: 'Ask' }).click();

            await expect(page.locator('#assistant-status')).toHaveText('Anthropic did not accept the API key.');
            await expect(page.locator('#assistant-status')).toHaveClass(/is-error/);
            await expect(page.getByLabel('Question')).toHaveValue('How are my stocks?');
            await expect(page.locator('.assistant-message')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Ask' })).toBeEnabled();
        });
    });

    test('says how to set it up when there is no API key', async ({ page }) => {
        await stubAssistant(page, { available: false });
        await page.goto('/');

        await expect(page.locator('#assistant-status')).toHaveText('To ask Claude, add an API key from Anthropic to the .env file (see the README).');
        await expect(page.getByLabel('Question')).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
    });

    test('asks the app itself, which says when no key is set up', async ({ page }) => {
        // Not stubbed: the test server has no key.
        await page.goto('/');

        await expect(page.locator('#assistant-status')).toHaveText(/add an API key/);
    });
});
