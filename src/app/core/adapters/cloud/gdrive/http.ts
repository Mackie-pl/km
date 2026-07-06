/**
 * Runtime-switched HTTP transport for all Google calls (Drive REST + the OAuth
 * token endpoint).
 *
 * In the browser, native `fetch` works (Google's APIs are CORS-enabled). Inside
 * a Tauri webview the request origin is `tauri://localhost`, which Google's
 * endpoints reject — so we route through `@tauri-apps/plugin-http`, whose `fetch`
 * runs in Rust and bypasses CORS entirely (the same trick the git adapter uses in
 * its `http.ts`). The plugin is dynamically imported so it never lands in the
 * browser bundle.
 */

import { isTauriRuntime } from '@core/utils/tauri-runtime';

export interface DriveFetchInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string | null;
}

export async function driveFetch(
	url: string,
	init: DriveFetchInit = {},
): Promise<Response> {
	if (isTauriRuntime()) {
		const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
		return tauriFetch(url, init);
	}
	return fetch(url, init);
}
