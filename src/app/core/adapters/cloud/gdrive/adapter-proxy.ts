/**
 * Lazy-loading proxy for GDriveAdapter.
 *
 * Eagerly registered in the ADAPTERS token but defers the Drive REST + OAuth
 * code until the first actual I/O operation (mirrors GitAdapterProxy).
 */

import type {
	Adapter,
	AdapterConfig,
	ConnectionTestResult,
	FileEntry,
	WatchEvent,
	WorkspacePickResult,
} from '../../adapter.interface';

export class GDriveAdapterProxy implements Adapter {
	readonly id = 'gdrive';
	readonly isLocal = false;

	/** @internal exposed for testing */
	real: Adapter | null = null;

	/**
	 * Available on every runtime the OAuth driver seam covers: the browser (GIS
	 * token model), Tauri desktop (loopback Auth-Code + PKCE), and Tauri Android
	 * (custom-scheme deep-link Auth-Code + PKCE).
	 */
	isAvailable(): boolean {
		return true;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		return Promise.resolve(null);
	}

	private async ensureLoaded(): Promise<Adapter> {
		if (!this.real) {
			const mod: { GDriveAdapter: new () => Adapter } =
				await import('./adapter');
			this.real = new mod.GDriveAdapter();
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
		throw new Error('GDriveAdapter: watch not supported');
	}

	async createDir(path: string, root?: string): Promise<void> {
		const adapter = await this.ensureLoaded();
		if (adapter.createDir) {
			return adapter.createDir(path, root);
		}
		throw new Error('GDriveAdapter: createDir not supported');
	}

	async testConnection(config: AdapterConfig): Promise<ConnectionTestResult> {
		const adapter = await this.ensureLoaded();
		if (adapter.testConnection) {
			return adapter.testConnection(config);
		}
		return { ok: true };
	}

	async registerScope(root: string): Promise<void> {
		const adapter = await this.ensureLoaded();
		if (adapter.registerScope) {
			return adapter.registerScope(root);
		}
	}
}
