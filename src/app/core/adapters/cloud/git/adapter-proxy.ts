/**
 * Lazy-loading proxy for GitAdapter.
 *
 * Eagerly registered (~1KB) in the ADAPTERS token but defers the ~350KB
 * isomorphic-git + LightningFS bundle until first actual I/O operation.
 */

import type {
	Adapter,
	AdapterConfig,
	ConnectionTestResult,
	FileEntry,
	WatchEvent,
	WorkspacePickResult,
} from '../../adapter.interface';

export class GitAdapterProxy implements Adapter {
	readonly id = 'git';
	readonly isLocal = false;

	/** @internal exposed for testing */
	real: Adapter | null = null;

	isAvailable(): boolean {
		return true;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		// Deferred: wizard UX for cloud adapter config comes later
		return Promise.resolve(null);
	}

	private async ensureLoaded(): Promise<Adapter> {
		if (!this.real) {
			// Dynamic import for lazy-loading — GitAdapter implements Adapter
			const mod: { GitAdapter: new () => Adapter } =
				await import('./adapter');
			this.real = new mod.GitAdapter();
		}
		return this.real;
	}

	async read(path: string, root?: string): Promise<string> {
		return (await this.ensureLoaded()).read(path, root);
	}

	async write(path: string, content: string, root?: string): Promise<void> {
		return (await this.ensureLoaded()).write(path, content, root);
	}

	async delete(path: string, root?: string): Promise<void> {
		return (await this.ensureLoaded()).delete(path, root);
	}

	async rename(
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		return (await this.ensureLoaded()).rename(oldPath, newPath, root);
	}

	async list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		return (await this.ensureLoaded()).list(path, root, recursive);
	}

	async watch(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void> {
		const adapter = await this.ensureLoaded();
		if (adapter.watch) {
			return adapter.watch(callback, root);
		}
		throw new Error('GitAdapter: watch not supported');
	}

	async createDir(path: string, root?: string): Promise<void> {
		const adapter = await this.ensureLoaded();
		if (adapter.createDir) {
			return adapter.createDir(path, root);
		}
		throw new Error('GitAdapter: createDir not supported');
	}

	async testConnection(config: AdapterConfig): Promise<ConnectionTestResult> {
		const adapter = await this.ensureLoaded();
		if (adapter.testConnection) {
			return adapter.testConnection(config);
		}
		return { ok: true };
	}

	async registerScope(_root: string): Promise<void> {
		// Git adapter uses repo URL as root — no OS-level scope to register
	}
}
