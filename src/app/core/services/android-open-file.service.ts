import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { navigateToEntry } from '@core/utils/router-utils';
import type { TauriFsAdapterConfig } from '@core/adapters/adapter.interface';
import { WorkspaceService } from './workspace.service';

interface AndroidIntentBridge {
	getPendingOpenUri(): string;
}

function getIntentBridge(): AndroidIntentBridge | null {
	return (
		(window as unknown as { AndroidIntentBridge?: AndroidIntentBridge })
			.AndroidIntentBridge ?? null
	);
}

/** A SAF `content://` URI broken into its provider authority + decoded document id. */
interface SafDocRef {
	authority: string;
	docId: string;
}

/**
 * Parse the tree document id out of a SAF tree URI, e.g.
 * `content://com.android.externalstorage.documents/tree/primary%3ANotes`.
 */
function parseTreeUri(uriStr: string): SafDocRef | null {
	const match = /^content:\/\/([^/]+)\/tree\/([^/]+)/.exec(uriStr);
	if (!match?.[1] || !match[2]) return null;
	return { authority: match[1], docId: decodeURIComponent(match[2]) };
}

/**
 * Parse the document id out of a single-document (or tree+document) SAF URI,
 * e.g. `content://.../document/primary%3ANotes%2Ffile.md`.
 */
function parseDocumentUri(uriStr: string): SafDocRef | null {
	const match = /^content:\/\/([^/]+)\/.*\/document\/([^/]+)$/.exec(uriStr);
	if (!match?.[1] || !match[2]) return null;
	return { authority: match[1], docId: decodeURIComponent(match[2]) };
}

/**
 * Handles Android's "Open with" flow: when the OS launches the app with a
 * file Intent (see MainActivity.kt's `AndroidIntentBridge`), checks whether
 * the file lives inside a workspace folder the user already opened, and if
 * so switches to it and opens the file. Otherwise surfaces a message asking
 * the user to open the containing folder as a workspace manually.
 *
 * Matching only works for SAF providers whose document ids embed the file
 * path (e.g. ExternalStorageProvider — "primary:Folder/file.md", used for
 * on-device storage). Providers with opaque ids (Drive, Downloads, ...) fall
 * through to "unsupported" since there's no reliable way to test containment.
 */
@Injectable({ providedIn: 'root' })
export class AndroidOpenFileService {
	private readonly router = inject(Router);
	private readonly workspaceService = inject(WorkspaceService);

	/** Set when a launch file couldn't be matched to any known workspace. */
	readonly unsupportedFile = signal<string | null>(null);

	dismissUnsupported(): void {
		this.unsupportedFile.set(null);
	}

	/** Call once at app startup. No-op if the app wasn't launched via "Open with". */
	async handleAppLaunch(): Promise<void> {
		const bridge = getIntentBridge();
		if (!bridge) return;

		let uri: string;
		try {
			uri = bridge.getPendingOpenUri();
		} catch {
			return;
		}
		if (!uri) return;

		const fileDoc = parseDocumentUri(uri);
		const match = fileDoc && this.#findContainingWorkspace(fileDoc);
		if (!match) {
			this.unsupportedFile.set(uri);
			return;
		}

		this.workspaceService.activateWorkspace(match.workspaceId);
		await navigateToEntry(this.router, match.relativePath);
	}

	#findContainingWorkspace(
		fileDoc: SafDocRef,
	): { workspaceId: string; relativePath: string } | null {
		let best: { workspaceId: string; relativePath: string } | null = null;
		let bestTreeDocIdLength = -1;

		for (const ws of this.workspaceService.workspaces()) {
			const config = ws.adapterConfigs.find(
				(c): c is TauriFsAdapterConfig => c.adapterId === 'tauri-fs',
			);
			if (!config) continue;

			const treeDoc = this.#parseWorkspaceRoot(config.path);
			if (treeDoc?.authority !== fileDoc.authority) continue;

			// The file must be strictly inside the tree, not the tree itself.
			const prefix = `${treeDoc.docId}/`;
			if (!fileDoc.docId.startsWith(prefix)) continue;

			if (treeDoc.docId.length > bestTreeDocIdLength) {
				bestTreeDocIdLength = treeDoc.docId.length;
				best = {
					workspaceId: ws.id,
					relativePath: fileDoc.docId.slice(prefix.length),
				};
			}
		}

		return best;
	}

	/** Workspace roots on Android are the JSON-serialized `FileUri`. */
	#parseWorkspaceRoot(root: string): SafDocRef | null {
		try {
			const parsed = JSON.parse(root) as {
				uri?: string;
				documentTopTreeUri?: string;
			};
			return parseTreeUri(parsed.documentTopTreeUri ?? parsed.uri ?? '');
		} catch {
			return null;
		}
	}
}
