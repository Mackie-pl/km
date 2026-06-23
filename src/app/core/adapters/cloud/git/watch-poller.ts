/**
 * Git remote watch poller — polls origin for changes via exponential backoff.
 */

import type { WatchEvent } from '../../adapter.interface';
import type { RepoEntry } from './types';
import {
	fetchRemote,
	fastForwardFromRemote,
	resolveRefSafe,
	diffCommitFiles,
} from './git-ops';
import { debugLog } from '@core/utils/debug-logger';

export interface WatchPoller {
	start(callback: (events: WatchEvent[]) => void): void;
	stop(): void;
}

/**
 * Create a poller that periodically fetches from the remote and fires a
 * callback with the precise per-file changes when the remote advances.
 *
 * A `git.fetch` only moves the remote-tracking ref (`origin/<branch>`) — never
 * local `HEAD` — so inbound changes are detected by comparing that ref, not
 * HEAD. On a change the local branch is fast-forwarded (so subsequent
 * reads/lists observe the new content) and the old→new commit diff is emitted
 * as create/modify/delete events.
 *
 * Uses exponential backoff (`baseIntervalMs` → up to 15min) on fetch failure
 * and respects `document.hidden` to pause polling when the tab is inactive.
 *
 * @param repo - The managed repo clone to poll.
 * @param getToken - Resolves the auth token for fetch (private remotes).
 * @param baseIntervalMs - Steady-state poll interval (from the adapter config).
 */
export function createWatchPoller(
	repo: RepoEntry,
	getToken: () => Promise<string | null>,
	baseIntervalMs = 30_000,
): WatchPoller {
	const BASE_INTERVAL =
		Number.isFinite(baseIntervalMs) && baseIntervalMs > 0
			? baseIntervalMs
			: 30_000;
	const MAX_INTERVAL = 15 * 60 * 1000;
	const remoteRef = `refs/remotes/origin/${repo.branch}`;
	let intervalMs = BASE_INTERVAL;
	let lastKnownSha: string | null = null;
	let active = false;
	let timerId: ReturnType<typeof setInterval> | null = null;
	let callback: ((events: WatchEvent[]) => void) | null = null;

	/**
	 * Fast-forward the local branch to the new remote tip and emit the precise
	 * per-file changes between the previously-known commit and the new one.
	 * When the local branch has diverged (can't fast-forward), defer to the
	 * push-phase conflict handling rather than emitting stale reads.
	 */
	const applyRemoteAdvance = async (
		fromSha: string,
		toSha: string,
	): Promise<void> => {
		const advanced = await fastForwardFromRemote(repo);
		if (!advanced) {
			debugLog(
				'[GitWatch] remote advanced but local diverged — deferring to push-phase conflict handling',
			);
			return;
		}
		const events = await diffCommitFiles(repo, fromSha, toSha);
		if (events.length > 0) callback?.(events);
	};

	const poll = async (): Promise<void> => {
		if (!active || document.hidden) return;

		try {
			await fetchRemote(repo, await getToken());
			intervalMs = BASE_INTERVAL;

			// Compare the REMOTE-tracking ref (origin/<branch>). A fetch never
			// moves local HEAD, so a HEAD-based comparison can never detect
			// inbound changes — only origin/<branch> advances when the remote
			// does.
			const remoteSha = await resolveRefSafe(repo, remoteRef);
			if (remoteSha === null) return;
			if (lastKnownSha !== null && remoteSha !== lastKnownSha) {
				await applyRemoteAdvance(lastKnownSha, remoteSha);
			}
			lastKnownSha = remoteSha;
		} catch {
			intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL);
		}
	};

	const handleVisibility = (): void => {
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

			// Seed the baseline from the current remote-tracking ref so we only
			// react to changes from now on (the initial sync is handled by the
			// pull-on-activation flow, not the poller).
			void resolveRefSafe(repo, remoteRef).then((sha) => {
				lastKnownSha = sha;
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
