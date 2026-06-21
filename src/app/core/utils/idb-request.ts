/**
 * Wrap an IDBRequest as a promise, resolving on success and rejecting on error.
 */
export function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => {
			resolve(request.result);
		};
		request.onerror = () => {
			reject(new Error(request.error?.message));
		};
	});
}
