/**
 * Git remote watch poller — polls origin for changes via exponential backoff.
 */

import type { WatchEvent } from '../../adapter.interface';
import type { GitFsBackend } from './types';
import git from 'isomorphic-git';
import http from './http';

export interface WatchPoller {
	start(callback: (events: WatchEvent[]) => void): void;
	stop(): void;
}

/**
 * Create a poller that periodically fetches from the remote and fires
 * a callback when HEAD changes.
 *
 * Uses exponential backoff (30s → up to 15min) on fetch failure and respects
 * `document.hidden` to pause polling when the tab is inactive.
 */
export function createWatchPoller(
	fs: GitFsBackend,
	cloneDir: string,
): WatchPoller {
	let intervalMs = 30_000;
	const MAX_INTERVAL = 15 * 60 * 1000;
	let lastKnownSha: string | null = null;
	let active = false;
	let timerId: ReturnType<typeof setInterval> | null = null;
	let callback: ((events: WatchEvent[]) => void) | null = null;

	const poll = async () => {
		if (!active || document.hidden) return;

		try {
			await git.fetch({
				fs,
				dir: cloneDir,
				http,
				remote: 'origin',
			});

			intervalMs = 30_000;

			const currentSha = await git.resolveRef({
				fs,
				dir: cloneDir,
				ref: 'HEAD',
			});

			if (lastKnownSha && lastKnownSha !== currentSha) {
				callback?.([{ type: 'modify', path: '/' }]);
			}
			lastKnownSha = currentSha;
		} catch {
			intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL);
		}
	};

	const handleVisibility = () => {
		if (!document.hidden && timerId === null && active) {
			timerId = setInterval(() => {
				void poll();
			}, intervalMs);
			void poll();
		} else if (document.hidden && timerId !== null) {
			clearInterval(timerId);
			timerId = null;
		}
	};

	return {
		start: (cb: (events: WatchEvent[]) => void) => {
			callback = cb;
			active = true;

			// Grab initial SHA (OK if no commits yet — poll will catch changes)
			git.resolveRef({ fs, dir: cloneDir, ref: 'HEAD' })
				.then((sha) => {
					lastKnownSha = sha;
				})
				.catch(() => {
					/* no commits yet */
				});

			timerId = setInterval(() => {
				void poll();
			}, intervalMs);
			document.addEventListener('visibilitychange', handleVisibility);
		},

		stop: () => {
			active = false;
			if (timerId !== null) {
				clearInterval(timerId);
				timerId = null;
			}
			document.removeEventListener('visibilitychange', handleVisibility);
			callback = null;
		},
	};
}
