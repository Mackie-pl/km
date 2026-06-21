/**
 * Debug logging for sync operations.
 *
 * Reads `debugSync` from SettingsService's localStorage entry so it works in
 * non-Angular contexts (adapters, plain classes) without DI.
 *
 * Usage:
 *   import { debugLog } from '@core/utils/debug-logger';
 *   debugLog('[Module] interesting detail:', data);
 */

const SETTINGS_KEY = 'app-settings';

/** Check whether the user has enabled sync debug logging in Settings. */
export function isDebugSyncEnabled(): boolean {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return false;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return parsed['debugSync'] === true;
	} catch {
		return false;
	}
}

/**
 * Log a debug message — visible only when debug sync is enabled in Settings.
 * Use this for verbose sync tracing (watch events, coalescing, branch decisions).
 */
export function debugLog(...args: unknown[]): void {
	if (isDebugSyncEnabled()) {
		console.warn('[DS]', ...args);
	}
}
