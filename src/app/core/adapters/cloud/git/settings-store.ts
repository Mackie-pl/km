/**
 * Per-repository git settings (branch, author identity, poll interval).
 *
 * These are the non-secret fields of `GitAdapterConfig` that the adapter needs
 * but which are NOT carried through the `Adapter` CRUD interface (its methods
 * only take `path`/`root`). They are persisted keyed by repo URL so a fresh
 * `GitAdapter` instance on the next session can rehydrate them.
 *
 * Stored in localStorage — unlike the PAT (see {@link GitTokenStore}), none of
 * these values are sensitive.
 */

export interface GitRepoSettings {
	branch: string;
	authorName: string;
	authorEmail: string;
	/** Watch poll interval in ms. */
	pollIntervalMs: number;
}

/** Fallbacks used when a field is missing/blank or no settings are stored. */
export const DEFAULT_GIT_SETTINGS: GitRepoSettings = {
	branch: 'main',
	authorName: 'Note App User',
	authorEmail: 'user@note-app.local',
	pollIntervalMs: 30_000,
};

const STORAGE_PREFIX = 'git-settings:';

/**
 * Coerce a possibly-partial / malformed settings object into a complete,
 * valid {@link GitRepoSettings}, falling back to defaults per field.
 */
export function normalizeGitSettings(
	raw: Partial<GitRepoSettings> | null | undefined,
): GitRepoSettings {
	const str = (v: unknown, fallback: string): string =>
		typeof v === 'string' && v.trim() ? v.trim() : fallback;

	const poll = Number(raw?.pollIntervalMs);
	return {
		branch: str(raw?.branch, DEFAULT_GIT_SETTINGS.branch),
		authorName: str(raw?.authorName, DEFAULT_GIT_SETTINGS.authorName),
		authorEmail: str(raw?.authorEmail, DEFAULT_GIT_SETTINGS.authorEmail),
		pollIntervalMs:
			Number.isFinite(poll) && poll > 0
				? poll
				: DEFAULT_GIT_SETTINGS.pollIntervalMs,
	};
}

export class GitSettingsStore {
	/** Read settings for a repo, normalized and defaulted. Never throws. */
	get(repoUrl: string): GitRepoSettings {
		try {
			const raw = localStorage.getItem(STORAGE_PREFIX + repoUrl);
			if (!raw) return { ...DEFAULT_GIT_SETTINGS };
			return normalizeGitSettings(
				JSON.parse(raw) as Partial<GitRepoSettings>,
			);
		} catch {
			return { ...DEFAULT_GIT_SETTINGS };
		}
	}

	/** Persist settings for a repo (normalized first). Best-effort. */
	set(repoUrl: string, settings: Partial<GitRepoSettings>): void {
		try {
			localStorage.setItem(
				STORAGE_PREFIX + repoUrl,
				JSON.stringify(normalizeGitSettings(settings)),
			);
		} catch {
			/* best-effort — storage may be full or unavailable */
		}
	}

	/** Remove stored settings for a repo. Best-effort. */
	delete(repoUrl: string): void {
		try {
			localStorage.removeItem(STORAGE_PREFIX + repoUrl);
		} catch {
			/* best-effort */
		}
	}
}
