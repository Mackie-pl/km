/**
 * Static configuration for the Google Drive adapter.
 *
 * Two OAuth clients are used:
 * - **Web** client (GIS token model) for the browser path — no secret needed.
 *   The client ID is public by design (visible in the browser), so it lives here.
 * - **Desktop** client (Auth Code + PKCE over a 127.0.0.1 loopback) for the Tauri
 *   desktop path. Its ID + (non-confidential installed-app) secret are injected
 *   at build time from env vars — this repo is public, so they are NOT committed.
 *   See ./desktop-secrets.ts and scripts/generate-gdrive-secrets.mjs.
 */

import { DESKTOP_OAUTH } from './desktop-secrets';

/** Public OAuth 2.0 client ID (Web application, used by the browser GIS flow). */
export const GOOGLE_OAUTH_CLIENT_ID =
	'311145204704-ee881dvsue8f3kakbkc4ug1ure1belvm.apps.googleusercontent.com';

/**
 * Desktop ("Installed app") OAuth client, used by the Tauri loopback flow.
 * Empty on web builds (the browser GIS flow needs no secret); populated on
 * desktop release builds via the build-time codegen step.
 */
export const GOOGLE_OAUTH_DESKTOP_CLIENT_ID = DESKTOP_OAUTH.clientId;
export const GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET = DESKTOP_OAUTH.clientSecret;

/**
 * Full Drive scope — chosen so the adapter can attach to pre-existing folders
 * and files, not only ones it created (`drive.file` cannot see those).
 */
export const GOOGLE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive'];

// ── Endpoints ────────────────────────────────────────────────────────────────

/** Authorization + token endpoints (desktop Auth-Code + PKCE flow). */
export const GOOGLE_AUTH_ENDPOINT =
	'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD_API =
	'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_CHANGES_API = 'https://www.googleapis.com/drive/v3/changes';

// ── Drive constants ──────────────────────────────────────────────────────────

/** mimeType that marks a Drive file as a folder. */
export const GDRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** mimeType written for note files. */
export const MARKDOWN_MIME = 'text/markdown';

/** Folder name used when the user leaves the folder field blank. */
export const DEFAULT_GDRIVE_FOLDER = 'Notes';

/** Default watch poll interval (ms). */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
