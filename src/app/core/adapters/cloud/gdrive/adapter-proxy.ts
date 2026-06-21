/**
 * Placeholder stub for the future GDriveAdapter proxy.
 *
 * Registered but commented-out in ADAPTERS. When the GDrive adapter is
 * implemented, replace this with a lazy proxy similar to GitAdapterProxy.
 */

import type {
	Adapter,
	FileEntry,
	WatchEvent,
	WorkspacePickResult,
} from '../../adapter.interface';

export class GDriveAdapterProxy implements Adapter {
	readonly id = 'gdrive';
	readonly isLocal = false;

	isAvailable(): boolean {
		return false;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		return Promise.resolve(null);
	}

	read(_path: string, _root?: string): Promise<string> {
		throw new Error('GDriveAdapter not yet implemented');
	}

	write(_path: string, _content: string, _root?: string): Promise<void> {
		throw new Error('GDriveAdapter not yet implemented');
	}

	delete(_path: string, _root?: string): Promise<void> {
		throw new Error('GDriveAdapter not yet implemented');
	}

	rename(_oldPath: string, _newPath: string, _root?: string): Promise<void> {
		throw new Error('GDriveAdapter not yet implemented');
	}

	list(
		_path: string,
		_root?: string,
		_recursive?: boolean,
	): Promise<FileEntry[]> {
		throw new Error('GDriveAdapter not yet implemented');
	}

	watch(
		_callback: (events: WatchEvent[]) => void,
		_root?: string,
	): Promise<() => void> {
		throw new Error('GDriveAdapter not yet implemented');
	}

	createDir(_path: string, _root?: string): Promise<void> {
		throw new Error('GDriveAdapter not yet implemented');
	}
}
