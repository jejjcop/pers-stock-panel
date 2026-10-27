// The "Ask about my stocks" panel: sends questions to /assistant, where
// Claude answers them (app/Services/StockAssistant.php), and shows the
// conversation. Loaded after app.js, whose csrfToken and
// sendToLoginIfLoggedOut it uses.
(() => {
    const log = document.getElementById('assistant-log');
    const form = document.getElementById('assistant-form');
    const question = document.getElementById('assistant-question');
    const askButton = form.querySelector('button[type="submit"]');
    const resetButton = document.getElementById('assistant-reset');
    const statusLine = document.getElementById('assistant-status');
    let waiting = false;
    let waitTimer = null;

    function showStatus(message, isError = false) {
        statusLine.textContent = message;
        statusLine.classList.toggle('is-error', isError);
    }

    function setWaiting(isWaiting) {
        waiting = isWaiting;
        askButton.disabled = isWaiting;
        resetButton.disabled = isWaiting;
        clearInterval(waitTimer);
        if (!isWaiting) {
            return;
        }
        const startedAt = Date.now();
        const update = () => {
            const seconds = Math.round((Date.now() - startedAt) / 1000);
            showStatus(seconds < 3 ? 'Claude is thinking...' : `Claude is thinking... ${seconds} s`);
        };
        update();
        waitTimer = setInterval(update, 1000);
    }

    function scrollToEnd() {
        log.scrollTop = log.scrollHeight;
    }

    // Text is shown as text, never as HTML, so nothing in an answer can run.
    function addMessage(role, text, sources = []) {
        const message = document.createElement('div');
        message.className = `assistant-message is-${role}`;
        const label = document.createElement('span');
        label.className = 'assistant-message-label';
        label.textContent = role === 'user' ? 'You' : 'Claude';
        const body = document.createElement('p');
        body.className = 'assistant-message-text';
        body.textContent = text;
        message.append(label, body);

        const links = sources.filter((source) => /^https?:\/\//i.test(source.url));
        if (links.length > 0) {
            const list = document.createElement('ul');
            list.className = 'assistant-sources';
            for (const source of links) {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = source.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = source.title || source.url;
                item.append(link);
                list.append(item);
            }
            message.append(list);
        }

        log.append(message);
        log.hidden = false;
        resetButton.hidden = false;
        scrollToEnd();
        return message;
    }

    function showTranscript(transcript) {
        log.replaceChildren();
        log.hidden = true;
        resetButton.hidden = true;
        for (const entry of transcript) {
            addMessage(entry.role, entry.text, entry.sources ?? []);
        }
    }

    async function load() {
        try {
            const response = await fetch('assistant', { headers: { Accept: 'application/json' } });
            if (sendToLoginIfLoggedOut(response)) {
                return;
            }
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error ?? 'The conversation could not be loaded.');
            }
            showTranscript(data.transcript);
            if (!data.available) {
                showStatus('To ask Claude, add an API key from Anthropic to the .env file (see the README).');
                question.disabled = true;
                askButton.disabled = true;
            }
        } catch (error) {
            showStatus(error.message, true);
        }
    }

    async function ask(text) {
        const pending = addMessage('user', text);
        question.value = '';
        setWaiting(true);
        try {
            const response = await fetch('assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': csrfToken },
                body: JSON.stringify({ question: text }),
            });
            if (sendToLoginIfLoggedOut(response)) {
                return;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error ?? 'Claude could not answer just now. Try again in a moment.');
            }
            addMessage('assistant', data.answer, data.sources ?? []);
            setWaiting(false);
            showStatus('');
        } catch (error) {
            // Give the question back, so it can be sent again.
            pending.remove();
            log.hidden = log.childElementCount === 0;
            resetButton.hidden = log.hidden;
            if (question.value === '') {
                question.value = text;
            }
            setWaiting(false);
            showStatus(error instanceof TypeError ? 'Could not reach the app. Is it still running?' : error.message, true);
        }
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = question.value.trim();
        if (text !== '' && !waiting) {
            ask(text);
        }
    });

    // Enter sends; Shift+Enter starts a new line.
    question.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    resetButton.addEventListener('click', async () => {
        try {
            const response = await fetch('assistant', {
                method: 'DELETE',
                headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrfToken },
            });
            if (sendToLoginIfLoggedOut(response)) {
                return;
            }
            if (!response.ok) {
                throw new Error('The conversation could not be cleared.');
            }
            showTranscript([]);
            showStatus('');
            question.focus();
        } catch (error) {
            showStatus(error.message, true);
        }
    });

    load();
})();
