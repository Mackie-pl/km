/**
 * Pause execution for a specified duration.
 * @param ms Duration in milliseconds
 */
export function timeout(ms: number): Promise<void> {
	return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
