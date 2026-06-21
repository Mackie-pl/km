import { type Router } from '@angular/router';

/**
 * Navigate to the editor route for a vault entry.
 *
 * Splits the path into segments so Angular preserves literal `/` in the URL
 * instead of encoding them as `%2F`.
 *
 * Usage:
 *   await navigateToEntry(this.router, 'New Folder8/fff.md');
 *   // → navigates to /e/New%20Folder8/fff.md  (clean, no %2F)
 */
export async function navigateToEntry(
	router: Router,
	path: string,
): Promise<boolean> {
	const segments = ['/e', ...path.split('/')];
	return router.navigate(segments).catch((err: unknown) => {
		console.error('Navigation error:', err);
		return false;
	});
}
