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

	/** In-memory directory store: set of directory paths */
	readonly dirs = new Set<string>();

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
		// Only available in E2E tests — tauri-mock.js sets this flag before
		// Angular bootstraps. In dev (ng serve / pnpm tauri dev), the flag
		// is absent so the real adapter (TauriFsAdapter / BrowserFileSystemApiAdapter)
		// is picked by getWorkspacePickerAdapter().
		return (
			typeof sessionStorage !== 'undefined' &&
			sessionStorage.getItem('KM_E2E_TEST') === 'true'
		);
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
		this.dirs.delete(path);
		return Promise.resolve();
	}

	rename(oldPath: string, newPath: string, _root?: string): Promise<void> {
		// Rename exact file match
		const content = this.files.get(oldPath);
		if (content !== undefined) {
			this.files.set(newPath, content);
			this.files.delete(oldPath);
		}
		// Rename children files (paths starting with oldPath + '/')
		for (const [key, val] of this.files.entries()) {
			if (key.startsWith(oldPath + '/')) {
				const childNewPath = newPath + key.slice(oldPath.length);
				this.files.set(childNewPath, val);
				this.files.delete(key);
			}
		}
		// Rename exact directory match
		if (this.dirs.has(oldPath)) {
			this.dirs.delete(oldPath);
			this.dirs.add(newPath);
		}
		// Rename children directories (paths starting with oldPath + '/')
		for (const dirKey of this.dirs) {
			if (dirKey.startsWith(oldPath + '/')) {
				const childNewPath = newPath + dirKey.slice(oldPath.length);
				this.dirs.delete(dirKey);
				this.dirs.add(childNewPath);
			}
		}
		return Promise.resolve();
	}

	createDir(path: string, _root?: string): Promise<void> {
		this.dirs.add(path);
		return Promise.resolve();
	}

	list(
		path: string,
		_root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		const entries: FileEntry[] = [];

		if (recursive) {
			// Recursive mode: return ALL entries under the path with full relative paths.
			// The in-memory store is flat (keys are full paths like "subdir/file.md"),
			// so we just filter by prefix and return everything.
			const prefix = path === '/' ? '' : path;
			for (const filePath of this.files.keys()) {
				if (!filePath.startsWith(prefix)) continue;
				this.addListEntryRecursive(entries, filePath, false);
			}
			for (const dirPath of this.dirs) {
				if (!dirPath.startsWith(prefix)) continue;
				this.addListEntryRecursive(entries, dirPath, true);
			}
		} else {
			// Non-recursive: only return direct children (first path segment)
			for (const filePath of this.files.keys()) {
				this.addListEntry(entries, filePath, path, false);
			}
			for (const dirPath of this.dirs) {
				this.addListEntry(entries, dirPath, path, true);
			}
		}

		return Promise.resolve(entries);
	}

	/** Add a single entry to the list result (dedup by name). */
	private addListEntry(
		entries: FileEntry[],
		itemPath: string,
		listPath: string,
		isDir: boolean,
	): void {
		if (!itemPath.startsWith(listPath === '/' ? '' : listPath)) return;
		const relative =
			listPath === '/'
				? itemPath
				: itemPath.slice(listPath.length).replace(/^\//, '');
		if (!relative) return;
		const namePart = relative.split('/')[0];
		if (!namePart) return;
		if (entries.some((e) => e.name === namePart)) return;
		entries.push({
			name: namePart,
			path: listPath === '/' ? namePart : `${listPath}/${namePart}`,
			isDirectory: isDir,
			lastModified: Date.now(),
		});
	}

	/**
	 * Add entry for recursive list mode - uses the full path as both name and path
	 * so nested entries like "subdir/file.md" are returned with their full relative path.
	 */
	private addListEntryRecursive(
		entries: FileEntry[],
		itemPath: string,
		isDir: boolean,
	): void {
		// Skip duplicates (in case a path exists in both files and dirs)
		if (entries.some((e) => e.path === itemPath)) return;
		entries.push({
			name: itemPath,
			path: itemPath,
			isDirectory: isDir,
			lastModified: Date.now(),
		});
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
		oldPath?: string,
	): void {
		if (type === 'rename' && oldPath) {
			this.#handleRenameEvent(path, content, oldPath);
			return;
		}

		this.#applyFileChange(type, path, content);

		const events: WatchEvent[] = [{ type, path }];
		this.#notifyWatchers(events);
	}

	/** Handle a rename (move) event — transfers content and triggers callbacks. */
	#handleRenameEvent(
		path: string,
		content: string | undefined,
		oldPath: string,
	): void {
		const existingContent = this.files.get(oldPath);
		this.files.set(path, content ?? existingContent ?? '');
		this.files.delete(oldPath);
		const events: WatchEvent[] = [{ type: 'rename', path, oldPath }];
		this.#notifyWatchers(events);
	}

	/** Apply a file create/update/delete to the in-memory map. */
	#applyFileChange(
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
	}

	/** Fire events to all registered watch callbacks. */
	#notifyWatchers(events: WatchEvent[]): void {
		for (const cb of this.watchCallbacks) {
			try {
				cb(events);
			} catch {
				// Ignore callback errors in tests
			}
		}
	}
}
