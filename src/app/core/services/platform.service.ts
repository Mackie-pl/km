import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { PLATFORM, type Platform } from '@core/types/constants';

/**
 * Detects the current OS platform by calling the Rust backend.
 *
 * TypeScript analogy: This is like `navigator.platform` but backed by
 * compile-time Rust `#[cfg]` checks — zero runtime overhead on the Rust side.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
	/** Raw platform string from the backend */
	readonly platform = signal<Platform>(PLATFORM.UNKNOWN);

	/** True when running on Android (mobile) */
	readonly isMobile = signal(false);

	/** True when running on Windows or Linux (desktop) */
	readonly isDesktop = signal(false);

	/** True when running inside a Tauri desktop build */
	readonly isDesktopTauri = signal(false);

	/** True when running under Tauri at all */
	readonly isTauri = signal(false);

	/** Whether the platform has been detected yet */
	readonly detected = signal(false);

	constructor() {
		const tauriAvailable = PlatformService.isTauriRuntimeAvailable(window);
		this.isTauri.set(tauriAvailable);
		void this.detect();
	}

	private static isTauriRuntimeAvailable(
		obj: unknown,
	): obj is { __TAURI_INTERNALS__: unknown } {
		return (
			typeof obj === 'object' &&
			obj !== null &&
			'__TAURI_INTERNALS__' in obj
		);
	}

	private async detect(): Promise<void> {
		const tauriAvailable = PlatformService.isTauriRuntimeAvailable(window);

		try {
			const result = await invoke<Platform>('get_platform');
			this.platform.set(result);
			this.isMobile.set(result === PLATFORM.ANDROID);
			const isDesktop =
				result === PLATFORM.WINDOWS || result === PLATFORM.LINUX;
			this.isDesktop.set(isDesktop || result === PLATFORM.UNKNOWN);
			this.isDesktopTauri.set(tauriAvailable && isDesktop);
		} catch {
			// Fallback: if Tauri API isn't available (e.g. running in browser dev),
			// treat as unknown — the UI will default to desktop behavior
			this.platform.set(PLATFORM.UNKNOWN);
			this.isDesktop.set(true);
			this.isDesktopTauri.set(false);
		} finally {
			this.detected.set(true);
		}
	}
}
