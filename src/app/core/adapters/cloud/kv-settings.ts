/**
 * Generic localStorage-backed settings store, keyed by a string identity and
 * namespaced by a prefix. Values are normalized through a caller-supplied
 * function so a missing/malformed entry always coerces to a complete object.
 *
 * Shared by the cloud adapters for their non-secret per-root settings (git:
 * branch/author/poll; Drive: resolved folder id/poll/email). Secrets never go
 * here — see {@link EncryptedStore} for those.
 */
export class KvSettingsStore<T> {
	/**
	 * @param prefix    localStorage key prefix (e.g. 'git-settings:').
	 * @param normalize Coerce a partial/unknown blob into a complete `T`.
	 */
	constructor(
		private readonly prefix: string,
		private readonly normalize: (raw: Partial<T> | null | undefined) => T,
	) {}

	/** Read settings for a key, normalized and defaulted. Never throws. */
	get(key: string): T {
		try {
			const raw = localStorage.getItem(this.prefix + key);
			if (!raw) return this.normalize(null);
			return this.normalize(JSON.parse(raw) as Partial<T>);
		} catch {
			return this.normalize(null);
		}
	}

	/** Persist settings for a key (normalized first). Best-effort. */
	set(key: string, value: Partial<T>): void {
		try {
			localStorage.setItem(
				this.prefix + key,
				JSON.stringify(this.normalize(value)),
			);
		} catch {
			/* best-effort — storage may be full or unavailable */
		}
	}

	/** Remove stored settings for a key. Best-effort. */
	delete(key: string): void {
		try {
			localStorage.removeItem(this.prefix + key);
		} catch {
			/* best-effort */
		}
	}
}
