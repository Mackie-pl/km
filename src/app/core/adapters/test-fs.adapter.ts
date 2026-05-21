import type {
	Adapter,
	FileEntry,
	WatchEvent,
	WorkspacePickResult,
} from './adapter.interface';

/**
 * In-memory test adapter for E2E tests.
 *
 * Stores files in a Map and exposes them for assertion.
 * Registers itself on `window.__KM_TEST_FS_ADAPTER__` so Playwright
 * tests can access the instance via page.evaluate().
 *
 * This adapter is harmless in production — its ID `'test-fs'` is never
 * activated unless explicitly configured in workspace settings or E2E.
 */
export class TestFsAdapter implements Adapter {
	readonly id = 'test-fs';
	readonly isLocal = true;

	/** In-memory file store: path → content */
	readonly files = new Map<string, string>();

	/** Registered watch callbacks — called by simulateExternalChange() during tests */
	private watchCallbacks: ((events: WatchEvent[]) => void)[] = [];

	/** @internal Self-register for test access */
	private static instances: TestFsAdapter[] = [];

	constructor() {
		TestFsAdapter.instances.push(this);
	}

	/** @internal Get all instances for E2E assertions */
	static getInstances(): readonly TestFsAdapter[] {
		return TestFsAdapter.instances;
	}

	isAvailable(): boolean {
		return true;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		return Promise.resolve({
			path: 'test:/TestVault',
			name: 'TestVault',
		});
	}

	read(path: string, _root?: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) {
			return Promise.reject(
				new Error(`TestFsAdapter: file not found "${path}"`),
			);
		}
		return Promise.resolve(content);
	}

	write(path: string, content: string, _root?: string): Promise<void> {
		this.files.set(path, content);
		return Promise.resolve();
	}

	delete(path: string, _root?: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}

	list(path: string, _root?: string): Promise<FileEntry[]> {
		const entries: FileEntry[] = [];
		for (const filePath of this.files.keys()) {
			if (!filePath.startsWith(path === '/' ? '' : path)) continue;
			const relative =
				path === '/'
					? filePath
					: filePath.slice(path.length).replace(/^\//, '');
			if (!relative) continue;
			const namePart = relative.split('/')[0];
			if (!namePart) continue;
			const isDirectory =
				relative.includes('/') || relative.endsWith('/');
			if (entries.some((e) => e.name === namePart)) continue;
			entries.push({
				name: namePart,
				path: path === '/' ? namePart : `${path}/${namePart}`,
				isDirectory,
				lastModified: Date.now(),
			});
		}
		return Promise.resolve(entries);
	}

	/**
	 * Subscribe to external change events.
	 * In tests, use `simulateExternalChange()` to trigger the callback.
	 */
	watch(
		callback: (events: WatchEvent[]) => void,
		_root?: string,
	): Promise<() => void> {
		this.watchCallbacks.push(callback);
		return Promise.resolve(() => {
			const idx = this.watchCallbacks.indexOf(callback);
			if (idx >= 0) this.watchCallbacks.splice(idx, 1);
		});
	}

	/**
	 * Simulate an external change (for E2E tests).
	 * Pre-seeds the file in memory, then triggers watch callbacks.
	 *
	 * TypeScript analogy: Like manually editing a .md file in VS Code while
	 * the app is running — the OS fires a filesystem event, the adapter
	 * detects it, and the app reconciles.
	 */
	simulateExternalChange(
		type: WatchEvent['type'],
		path: string,
		content?: string,
	): void {
		if (type !== 'delete' && content !== undefined) {
			this.files.set(path, content);
		}
		if (type === 'delete') {
			this.files.delete(path);
		}

		const events: WatchEvent[] = [{ type, path }];
		for (const cb of this.watchCallbacks) {
			try {
				cb(events);
			} catch {
				// Ignore callback errors in tests
			}
		}
	}
}
