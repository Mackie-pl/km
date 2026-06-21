import { type UrlMatcher, UrlSegment } from '@angular/router';

/**
 * Custom matcher for `/e/<file-path>` routes.
 *
 * Consumes everything after `/e/` as a single `entryId` parameter with literal
 * slashes (no `%2F` encoding). This produces clean URLs like:
 *   `/e/New Folder8/fff.md`
 * instead of:
 *   `/e/New%20Folder8%2Ffff.md`
 */
export const filePathMatcher: UrlMatcher = (url: UrlSegment[]) => {
	if (url.length === 0 || url[0]?.path !== 'e') return null;

	const filePath = url
		.slice(1)
		.map((segment) => segment.path)
		.join('/');

	if (filePath.length === 0) return null;

	return {
		consumed: url,
		posParams: {
			entryId: new UrlSegment(filePath, {}),
		},
	};
};
