/**
 * Per-root (folder-id keyed) non-secret Google Drive settings.
 *
 * Persisted in localStorage so a fresh adapter instance on the next session
 * honors the configured poll interval / folder name without re-running
 * `testConnection`. Secrets (OAuth tokens) live in {@link GDriveTokenStore}.
 * Mechanics come from the shared {@link KvSettingsStore}.
 */

import { KvSettingsStore } from '../kv-settings';
import { DEFAULT_POLL_INTERVAL_MS } from './config';

export interface GDriveSettings {
	/** Watch poll interval in ms. */
	pollIntervalMs: number;
	/** Display name of the resolved folder. */
	folderName: string;
}

export const DEFAULT_GDRIVE_SETTINGS: GDriveSettings = {
	pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
	folderName: '',
};

const STORAGE_PREFIX = 'gdrive-settings:';

export function normalizeGDriveSettings(
	raw: Partial<GDriveSettings> | null | undefined,
): GDriveSettings {
	const poll = Number(raw?.pollIntervalMs);
	return {
		pollIntervalMs:
			Number.isFinite(poll) && poll > 0
				? poll
				: DEFAULT_GDRIVE_SETTINGS.pollIntervalMs,
		folderName:
			typeof raw?.folderName === 'string'
				? raw.folderName
				: DEFAULT_GDRIVE_SETTINGS.folderName,
	};
}

export class GDriveSettingsStore extends KvSettingsStore<GDriveSettings> {
	constructor() {
		super(STORAGE_PREFIX, normalizeGDriveSettings);
	}
}
