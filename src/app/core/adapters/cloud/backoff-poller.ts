/**
 * Visibility-aware polling loop with exponential backoff.
 *
 * Shared by the cloud adapters' `watch()` implementations (git remote fetch,
 * Drive Changes API). The caller supplies the work in `poll`; this module owns
 * the scheduling concerns:
 *
 * - pauses while `document.hidden` (battery/bandwidth on mobile/background tabs)
 * - resets to the base interval after a successful poll
 * - doubles the interval up to `maxIntervalMs` whenever `poll` throws
 * - re-runs immediately when the tab becomes visible again
 *
 * Self-rescheduling via `setTimeout` (not a fixed `setInterval`) so the backoff
 * interval actually takes effect between runs.
 */

export interface BackoffPoller {
	start(): void;
	stop(): void;
}

export interface BackoffPollerOptions {
	/** Work to run each tick. Throwing triggers backoff. */
	poll: () => Promise<void>;
	/** Steady-state interval in ms. Default 30_000. */
	baseIntervalMs?: number;
	/** Ceiling for the backoff interval in ms. Default 15min. */
	maxIntervalMs?: number;
}

const DEFAULT_BASE = 30_000;
const DEFAULT_MAX = 15 * 60 * 1000;

/** Coerce to a positive finite number, falling back when invalid. */
function positiveOr(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

export function createBackoffPoller(
	opts: BackoffPollerOptions,
): BackoffPoller {
	const base = positiveOr(opts.baseIntervalMs, DEFAULT_BASE);
	const max = positiveOr(opts.maxIntervalMs, DEFAULT_MAX);

	let intervalMs = base;
	let active = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clear = (): void => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const schedule = (): void => {
		clear();
		if (!active) return;
		timer = setTimeout(() => void run(), intervalMs);
	};

	const run = async (): Promise<void> => {
		if (!active) return;
		// Skip the work while hidden, but keep a heartbeat so we resume on show
		// even if the visibility event is missed.
		if (typeof document !== 'undefined' && document.hidden) {
			schedule();
			return;
		}
		try {
			await opts.poll();
			intervalMs = base;
		} catch {
			intervalMs = Math.min(intervalMs * 2, max);
		}
		schedule();
	};

	const handleVisibility = (): void => {
		if (active && typeof document !== 'undefined' && !document.hidden) {
			// Became visible — poll right away rather than waiting out the timer.
			void run();
		}
	};

	return {
		start: () => {
			if (active) return;
			active = true;
			if (typeof document !== 'undefined') {
				document.addEventListener('visibilitychange', handleVisibility);
			}
			schedule();
		},
		stop: () => {
			active = false;
			clear();
			if (typeof document !== 'undefined') {
				document.removeEventListener(
					'visibilitychange',
					handleVisibility,
				);
			}
		},
	};
}
