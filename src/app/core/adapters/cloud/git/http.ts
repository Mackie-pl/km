/**
 * Tauri-bundled HTTP client for isomorphic-git.
 *
 * isomorphic-git needs an HTTP client whose `request()` method makes
 * network calls.  In the browser the standard `http/web` client uses the
 * native `fetch()` which is blocked by CORS for cross-origin Git remotes.
 *
 * This client uses `@tauri-apps/plugin-http` which runs HTTP requests
 * through Tauri's Rust backend, bypassing CORS entirely.
 *
 * TypeScript analogy: isomorphic-git's `http/web` → browser fetch (CORS-limited)
 * This module            → Rust fetch (no CORS — runs outside the browser sandbox)
 */

import { fetch } from '@tauri-apps/plugin-http';
import type {
	GitHttpRequest,
	GitHttpResponse,
} from 'isomorphic-git';

// ── Helpers ────────────────────────────────────────────────────────────────

async function collect(
	iterable: AsyncIterableIterator<Uint8Array>,
): Promise<Uint8Array> {
	let size = 0;
	const buffers: Uint8Array[] = [];
	for await (const value of iterable) {
		buffers.push(value);
		size += value.byteLength;
	}
	const result = new Uint8Array(size);
	let nextIndex = 0;
	for (const buffer of buffers) {
		result.set(buffer, nextIndex);
		nextIndex += buffer.byteLength;
	}
	return result;
}

/**
 * Convert a web `ReadableStream` to an async iterator.
 */
function fromStream(
	stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<Uint8Array> {
	const reader = stream.getReader();
	return {
		next() {
			return reader.read() as Promise<IteratorResult<Uint8Array>>;
		},
		return() {
			reader.releaseLock();
			return Promise.resolve({ done: true as const, value: undefined });
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
}

// ── Public API ─────────────────────────────────────────────────────────────

async function request({
	url,
	method = 'GET',
	headers = {},
	body,
}: GitHttpRequest): Promise<GitHttpResponse> {
	// Streaming uploads aren't possible — collect the full body first.
	let bodyInit: BodyInit | undefined;
	if (body) {
		bodyInit = (await collect(body)) as unknown as BodyInit;
	}

	// Supplied method will always be a string due to the default above.
	const res = await fetch(url, {
		method,
		headers,
		body: bodyInit ?? null,
	});

	// Response.body may be null for certain status codes (204, 304 etc.)
	let iter: AsyncIterableIterator<Uint8Array>;
	if (res.body) {
		iter = fromStream(res.body);
	} else {
		iter = [new Uint8Array(0)][Symbol.iterator]() as unknown as AsyncIterableIterator<Uint8Array>;
	}

	// Convert Headers object to a plain record.
	const plainHeaders: Record<string, string> = {};
	res.headers.forEach((value: string, key: string) => {
		plainHeaders[key] = value;
	});

	return {
		url: res.url,
		method,
		statusCode: res.status,
		statusMessage: res.statusText,
		body: iter,
		headers: plainHeaders,
	};
}

const tauriHttp = { request };

export default tauriHttp;
export { request };
