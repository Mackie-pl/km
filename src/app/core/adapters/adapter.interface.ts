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
	type: 'create' | 'modify' | 'delete';
	path: string;
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

	/** Read a file's text content. */
	read(path: string, root?: string): Promise<string>;
	/** Write text content to a file, creating parent directories if needed. */
	write(path: string, content: string, root?: string): Promise<void>;
	/** Delete a file or empty directory. */
	delete(path: string, root?: string): Promise<void>;
	/** List entries in a directory (non-recursive). */
	list(path: string, root?: string): Promise<FileEntry[]>;
	/** Optional: subscribe to filesystem changes. Returns an unsubscribe fn. */
	watch?(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void>;
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

/** Discriminated union of all adapter-specific configurations */
export type AdapterConfig =
	| TauriFsAdapterConfig
	| BrowserFsAdapterConfig
	| TestFsAdapterConfig;

/** All known adapter IDs — derived from the discriminated union */
export type AdapterId = AdapterConfig['adapterId'];
