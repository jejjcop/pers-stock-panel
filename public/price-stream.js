// Live prices from Yahoo Finance's websocket stream, the one Yahoo's own site
// uses. Each message carries one stock's latest trade as a base64-encoded
// protobuf "PricingData" message. The stream is unofficial and undocumented;
// the field numbers below follow the open-source yfinance project. The page
// falls back to polling quotes.php whenever the stream is not working.
const PriceStream = (() => {
    const url = 'wss://streamer.finance.yahoo.com/?version=2';
    const firstRetryMs = 2_000;
    const maxRetryMs = 60_000;

    // Field number -> [name, type]. Fields not listed here are skipped.
    const fields = {
        1: ['id', 'string'],
        2: ['price', 'float'],
        3: ['time', 'sint64'],
        4: ['currency', 'string'],
        5: ['exchange', 'string'],
        7: ['marketHours', 'int'],
        8: ['changePercent', 'float'],
        9: ['dayVolume', 'sint64'],
        10: ['dayHigh', 'float'],
        11: ['dayLow', 'float'],
        12: ['change', 'float'],
        13: ['shortName', 'string'],
        16: ['previousClose', 'float'],
    };

    // Yahoo's marketHours values.
    const sessions = { 0: 'preMarket', 1: 'regular', 2: 'afterHours', 3: 'afterHours' };

    function decodePricingData(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;
        const readVarint = () => {
            let result = 0n;
            let shift = 0n;
            let byte;
            do {
                if (offset >= bytes.length) {
                    throw new Error('The message ended in the middle of a number.');
                }
                byte = bytes[offset++];
                result |= BigInt(byte & 0x7f) << shift;
                shift += 7n;
            } while (byte & 0x80);
            return result;
        };

        const decoded = {};
        while (offset < bytes.length) {
            const tag = Number(readVarint());
            const fieldNumber = tag >> 3;
            const wireType = tag & 7;
            let value;
            if (wireType === 0) {
                value = readVarint();
            } else if (wireType === 1) {
                value = view.getFloat64(offset, true);
                offset += 8;
            } else if (wireType === 2) {
                const length = Number(readVarint());
                value = bytes.subarray(offset, offset + length);
                offset += length;
            } else if (wireType === 5) {
                value = view.getFloat32(offset, true);
                offset += 4;
            } else {
                throw new Error(`Unknown protobuf wire type ${wireType}.`);
            }

            const field = fields[fieldNumber];
            if (!field) {
                continue;
            }
            const [name, type] = field;
            if (type === 'string') {
                decoded[name] = new TextDecoder().decode(value);
            } else if (type === 'sint64') {
                // Zigzag encoding: 0, -1, 1, -2, ... are stored as 0, 1, 2, 3, ...
                decoded[name] = Number((value >> 1n) ^ -(value & 1n));
            } else if (type === 'int') {
                decoded[name] = Number(value);
            } else {
                decoded[name] = value;
            }
        }

        return decoded;
    }

    // Turns one websocket message into { ticker, price, session, time, ... },
    // or null when it is not a usable price update.
    function decodeMessage(text) {
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            return null;
        }
        if (!payload || payload.type !== 'pricing' || typeof payload.message !== 'string') {
            return null;
        }

        let data;
        try {
            data = decodePricingData(Uint8Array.from(atob(payload.message), (character) => character.charCodeAt(0)));
        } catch {
            return null;
        }
        if (typeof data.id !== 'string' || !Number.isFinite(data.price) || data.price <= 0) {
            return null;
        }

        return {
            ticker: data.id.toUpperCase(),
            price: data.price,
            session: sessions[data.marketHours] ?? 'regular',
            // Milliseconds; 0 when the message has no time.
            time: Number.isFinite(data.time) ? data.time : 0,
            changePercent: Number.isFinite(data.changePercent) ? data.changePercent : null,
        };
    }

    // Opens the stream and keeps it open. onPrice receives each decoded
    // update; onStateChange receives 'connecting', 'live' or 'down'.
    function create({ onPrice, onStateChange }) {
        const tickers = new Set();
        let socket = null;
        let state = null;
        let retryMs = firstRetryMs;
        let retryTimer = null;
        let openedAt = 0;
        let lastMessageAt = 0;

        const setState = (newState) => {
            if (newState !== state) {
                state = newState;
                onStateChange(state);
            }
        };

        const send = (message) => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(message));
            }
        };

        const scheduleReconnect = () => {
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(connect, retryMs);
            retryMs = Math.min(retryMs * 2, maxRetryMs);
        };

        function connect() {
            window.clearTimeout(retryTimer);
            if (typeof WebSocket === 'undefined') {
                setState('down');
                return;
            }

            setState(state === 'live' ? 'connecting' : state ?? 'connecting');
            let current;
            try {
                current = new WebSocket(url);
            } catch {
                setState('down');
                scheduleReconnect();
                return;
            }
            socket = current;

            current.addEventListener('open', () => {
                if (current !== socket) {
                    return;
                }
                retryMs = firstRetryMs;
                openedAt = Date.now();
                if (tickers.size > 0) {
                    send({ subscribe: Array.from(tickers) });
                }
                setState('live');
            });
            current.addEventListener('message', async (event) => {
                if (current !== socket) {
                    return;
                }
                const text = typeof event.data === 'string' ? event.data : await event.data.text();
                const update = decodeMessage(text);
                if (update && tickers.has(update.ticker)) {
                    lastMessageAt = Date.now();
                    onPrice(update);
                }
            });
            current.addEventListener('close', () => {
                if (current !== socket) {
                    return;
                }
                socket = null;
                setState('down');
                scheduleReconnect();
            });
        }

        connect();

        return {
            // Subscribes to these tickers and unsubscribes from any others.
            setTickers(list) {
                const wanted = new Set(list.map((ticker) => ticker.toUpperCase()));
                const added = Array.from(wanted).filter((ticker) => !tickers.has(ticker));
                const removed = Array.from(tickers).filter((ticker) => !wanted.has(ticker));
                removed.forEach((ticker) => tickers.delete(ticker));
                added.forEach((ticker) => tickers.add(ticker));
                if (added.length > 0) {
                    send({ subscribe: added });
                }
                if (removed.length > 0) {
                    send({ unsubscribe: removed });
                }
            },
            // Drops the current connection and connects again straight away.
            reconnect() {
                const old = socket;
                socket = null;
                old?.close();
                retryMs = firstRetryMs;
                connect();
            },
            isLive: () => state === 'live',
            // When the stream last delivered a price, or when it opened if no
            // price has come since.
            lastActivityAt: () => Math.max(openedAt, lastMessageAt),
        };
    }

    return { create, decodeMessage, decodePricingData };
})();
