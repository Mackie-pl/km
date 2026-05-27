// storage-manager.service.ts
import { Injectable, inject } from '@angular/core';
import { Adapter, FileEntry } from './adapter.interface';
import { ADAPTERS } from './token';

/**
 * Manages all registered storage adapters.
 *
 * This is a pure utility — it receives adapter IDs as parameters rather than
 * reading global state. WorkspaceService owns the "which adapters are active"
 * decision and passes IDs here.
 */
@Injectable({ providedIn: 'root' })
export class AdaptersManager {
	private readonly strategies = inject(ADAPTERS);

	/**
	 * Filter registered adapters by a list of IDs.
	 * @param ids - Adapter IDs to look up
	 * @returns Matching Adapter instances (order preserved from strategies)
	 */
	getAdaptersByIds(ids: string[]): Adapter[] {
		return this.strategies.filter((s) => ids.includes(s.id));
	}

	/**
	 * Find the first available local adapter for workspace folder picking.
	 * Used during workspace creation — not tied to any specific workspace.
	 * @returns The first available local adapter, or null if none found
	 */
	getWorkspacePickerAdapter(): Adapter | null {
		return (
			this.strategies.find((a) => a.isLocal && a.isAvailable()) ?? null
		);
	}

	/**
	 * Write content to all specified adapters.
	 */
	async write(
		path: string,
		content: string,
		adapterIds: string[],
		root?: string,
	): Promise<void> {
		const adapters = this.getAdaptersByIds(adapterIds);
		await Promise.all(adapters.map((a) => a.write(path, content, root)));
	}

	/**
	 * Read content from a single adapter.
	 */
	async read(
		path: string,
		adapterId: string,
		root?: string,
	): Promise<string> {
		const adapters = this.getAdaptersByIds([adapterId]);
		if (adapters.length === 0)
			throw new Error(`Adapter "${adapterId}" not found`);
		const a = adapters[0];
		if (!a) throw new Error(`Adapter "${adapterId}" not found`);
		return a.read(path, root);
	}

	/**
	 * List directory entries on all specified adapters.
	 * When recursive=true, walks subdirectories on each adapter.
	 */
	async list(
		path: string,
		adapterIds: string[],
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[][]> {
		const adapters = this.getAdaptersByIds(adapterIds);
		return Promise.all(
			adapters.map((a) => a.list(path, root, recursive)),
		);
	}

	/**
	 * Delete a file from all specified adapters.
	 */
	async deleteFile(
		path: string,
		adapterIds: string[],
		root?: string,
	): Promise<void> {
		const adapters = this.getAdaptersByIds(adapterIds);
		await Promise.all(adapters.map((a) => a.delete(path, root)));
	}
}
