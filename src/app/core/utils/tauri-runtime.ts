/**
 * Detect whether the app is running inside a Tauri runtime.
 *
 * Tauri injects `__TAURI_INTERNALS__` onto `window`. Adapters that depend on
 * Tauri-only capabilities (native FS, the Rust-backed HTTP client that the git
 * adapter uses to bypass CORS) gate their availability on this.
 */
export function isTauriRuntime(): boolean {
	return (
		typeof window !== 'undefined' &&
		'__TAURI_INTERNALS__' in window &&
		(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null
	);
}
