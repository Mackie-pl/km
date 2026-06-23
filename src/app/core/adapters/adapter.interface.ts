export interface WorkspacePickResult {
	path: string;
	name: string;
}

export interface FileEntry {
	path: string;
	name: string;
	isDirectory: boolean;
	/** Unix timestamp (ms). 0 if unknown. */
	lastModified: number;
}

export interface WatchEvent {
	type: 'create' | 'modify' | 'delete' | 'rename';
	path: string;
	/** Previous path for rename events. */
	oldPath?: string;
}

/** Result of an adapter connection test. */
export interface ConnectionTestResult {
	ok: boolean;
	error?: string;
}

/**
 * Storage adapter — text-oriented file I/O abstraction.
 *
 * Adapters are singletons provided via the ADAPTERS injection token.
 * The `root` parameter on each method is the workspace base path
 * from the workspace's `adapterConfigs[].path`.
 */
export interface Adapter {
	readonly id: AdapterId;
	readonly isLocal: boolean;

	isAvailable(): boolean;
	pickWorkspaceFolder(): Promise<WorkspacePickResult | null>;

	/**
	 * Optional: test whether the remote/store is reachable with the given config.
	 * Called during config form save to validate the connection before persisting.
	 * Returns { ok: true } on success, { ok: false, error: string } on failure.
	 */
	testConnection?(config: AdapterConfig): Promise<ConnectionTestResult>;

	/** Read a file's text content. */
	read(path: string, root?: string): Promise<string>;
	/** Write text content to a file, creating parent directories if needed. */
	write(path: string, content: string, root?: string): Promise<void>;
	/** Delete a file or empty directory. */
	delete(path: string, root?: string): Promise<void>;
	/** Rename a file or directory (atomic if the backing FS supports it). */
	rename(oldPath: string, newPath: string, root?: string): Promise<void>;
	/**
	 * List entries in a directory.
	 * When recursive=true, walks subdirectories and returns ALL entries
	 * with full relative paths from the listed directory.
	 */
	list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]>;
	/** Optional: subscribe to filesystem changes. Returns an unsubscribe fn. */
	watch?(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void>;

	/** Optional: create a directory (and all parents). */
	createDir?(path: string, root?: string): Promise<void>;

	/**
	 * Optional: register a root path with the platform's permission scope.
	 * Called on workspace activation so the adapter can authorize future
	 * read/write operations on the path.
	 *
	 * Implemented by adapters whose backing store requires permissions
	 * to be granted per-path (e.g. Tauri's FS scope).
	 */
	registerScope?(root: string): Promise<void>;
}

// ============================================================================
// Adapter-specific configuration — discriminated union keyed by adapterId
// ============================================================================

/** Configuration for the Tauri filesystem adapter */
export interface TauriFsAdapterConfig {
	readonly adapterId: 'tauri-fs';
	/** Local filesystem path where this workspace is mirrored */
	path: string;
}

/** Configuration for the Browser File System API adapter */
export interface BrowserFsAdapterConfig {
	readonly adapterId: 'browser-file-system-api';
	/** Browser-side path identifier where this workspace is mirrored */
	path: string;
}

/** Configuration for the test adapter */
export interface TestFsAdapterConfig {
	readonly adapterId: 'test-fs';
	/** Logical root identifier */
	path: string;
}

/** Configuration for the Git protocol cloud adapter */
export interface GitAdapterConfig {
	readonly adapterId: 'git';
	/** Remote repository URL (e.g. https://github.com/user/repo.git) */
	repoUrl: string;
	/** Branch to sync with (defaults to 'main') */
	branch: string;
	/**
	 * Personal Access Token for authentication.
	 *
	 * TRANSIENT — present only while the config flows through the config form
	 * and `testConnection`. It is NEVER persisted in the workspace config
	 * (which lives in plaintext localStorage); the durable home for the token
	 * is the encrypted `GitTokenStore`. `WorkspaceService` strips this field
	 * before storing, so persisted/loaded configs have it `undefined`.
	 */
	token?: string;
	/** Author name for commits */
	authorName: string;
	/** Author email for commits */
	authorEmail: string;
	/** Polling interval in ms for watch() (default: 30000) */
	pollIntervalMs: number;
}

/** Configuration stub for the future GDrive cloud adapter */
export interface GDriveAdapterConfig {
	readonly adapterId: 'gdrive';
	/** Google Drive folder ID or path */
	path: string;
}

/** Discriminated union of all adapter-specific configurations */
export type AdapterConfig =
	| TauriFsAdapterConfig
	| BrowserFsAdapterConfig
	| TestFsAdapterConfig
	| GitAdapterConfig
	| GDriveAdapterConfig;

/** All known adapter IDs — derived from the discriminated union */
export type AdapterId = AdapterConfig['adapterId'];

/**
 * Extract the root path/identifier from an adapter config.
 * Local adapters store it in `path`, git uses `repoUrl`.
 */
export function getAdapterRoot(config: AdapterConfig): string {
	if (config.adapterId === 'git') return config.repoUrl;
	return config.path;
}
