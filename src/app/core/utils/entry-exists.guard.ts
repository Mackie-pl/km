import { inject } from '@angular/core';
import { type CanMatchFn, UrlSegment } from '@angular/router';
import { VaultStore } from '@vault/store';

/**
 * Guard that only allows navigation to `/e/<path>` if the vault
 * contains an entry matching that path. If the entry doesn't exist,
 * the route won't match and Angular falls through to the `**` catch-all
 * (which shows the "Let's start" Empty component).
 *
 * Waits for vault initialization so that restoring a note URL on app
 * startup (e.g. after page reload) works correctly.
 */
export const entryExistsGuard: CanMatchFn = async (
	_route,
	segments: UrlSegment[],
) => {
	if (segments.length === 0 || segments[0]?.path !== 'e') return false;

	const entryId = segments
		.slice(1)
		.map((s) => s.path)
		.join('/');
	if (!entryId) return false;

	const vault = inject(VaultStore);
	await vault.ensureInitialized();
	return !!vault.getByPath(entryId);
};
