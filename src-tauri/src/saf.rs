//! Storage Access Framework (SAF) file operations for Android.
//!
//! On Android the app can't use filesystem paths for user-picked folders
//! (scoped storage). Instead the folder is a `content://` tree URI obtained
//! via `tauri-plugin-android-fs`'s directory picker, and all I/O goes through
//! that plugin keyed by URIs.
//!
//! These commands preserve the app's `(root, relativePath)` model: `root` is
//! the JSON-serialized `FileUri` of the picked workspace folder (carrying both
//! `uri` and `documentTopTreeUri`, both of which the plugin needs to resolve
//! children), and `path` is a forward-slash relative path within it.
//!
//! The plugin's async API exists on all targets but returns `NOT_ANDROID` off
//! Android, so these commands compile everywhere and simply error on desktop —
//! where the path-based `TauriFsAdapter` is used instead.

use serde::Serialize;
use tauri_plugin_android_fs::{AndroidFsExt, Entry, FileUri, UriPermission};

/// One directory entry, shaped to match the frontend `FileEntry` interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafEntry {
    /// Path relative to the listed directory (forward slashes).
    path: String,
    name: String,
    is_directory: bool,
    /// Unix timestamp in milliseconds; 0 if unknown.
    last_modified: u64,
}

/// Parse the workspace root back into a `FileUri`.
///
/// New workspaces store the full JSON-serialized `FileUri`. Workspaces picked
/// before that change stored only the bare URI string; we fall back to treating
/// the value as a raw URI so it parses — though such roots lack
/// `documentTopTreeUri` and must be re-picked to actually resolve children.
fn parse_root(root: &str) -> Result<FileUri, String> {
    FileUri::from_json_str(root)
        .or_else(|_| Ok::<FileUri, String>(FileUri::from_uri(root.to_string())))
}

/// Normalize a relative path: trim slashes; treat "" / "/" / "." as the root.
fn clean_rel(path: &str) -> &str {
    path.trim_matches('/').trim_start_matches("./")
}

/// Milliseconds since the Unix epoch for a `SystemTime`, saturating to 0.
fn to_millis(t: std::time::SystemTime) -> u64 {
    t.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Split a relative path into (parent, file_name). Parent is "" for top-level.
fn split_parent(rel: &str) -> (&str, &str) {
    match rel.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", rel),
    }
}

/// Read a text file at `path` within the workspace `root`.
#[tauri::command]
pub async fn saf_read(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<String, String> {
    let root_uri = parse_root(&root)?;
    let api = app.android_fs_async();
    let file = api
        .resolve_file_uri(&root_uri, clean_rel(&path))
        .await
        .map_err(|e| format!("resolve {path}: {e}"))?;
    api.read_to_string(&file)
        .await
        .map_err(|e| format!("read {path}: {e}"))
}

/// Write text to `path` within `root`, creating the file (and any missing
/// parent directories) if it doesn't exist yet.
#[tauri::command]
pub async fn saf_write(
    app: tauri::AppHandle,
    root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let root_uri = parse_root(&root)?;
    let rel = clean_rel(&path);
    let api = app.android_fs_async();

    // Reuse the existing file if present; otherwise create it. create_new_file
    // creates missing parent directories automatically.
    let file = match api.resolve_file_uri(&root_uri, rel).await {
        Ok(uri) => uri,
        Err(_) => api
            .create_new_file(&root_uri, rel, mime_for(rel))
            .await
            .map_err(|e| format!("create {path}: {e}"))?,
    };

    api.write(&file, content.as_bytes())
        .await
        .map_err(|e| format!("write {path}: {e}"))
}

/// Delete the file or directory at `path` within `root`.
#[tauri::command]
pub async fn saf_delete(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<(), String> {
    let root_uri = parse_root(&root)?;
    let rel = clean_rel(&path);
    let api = app.android_fs_async();

    // Try as a file first; fall back to a directory (removed recursively).
    if let Ok(file) = api.resolve_file_uri(&root_uri, rel).await {
        return api
            .remove_file(&file)
            .await
            .map_err(|e| format!("delete file {path}: {e}"));
    }
    let dir = api
        .resolve_dir_uri(&root_uri, rel)
        .await
        .map_err(|e| format!("resolve {path}: {e}"))?;
    api.remove_dir_all(&dir)
        .await
        .map_err(|e| format!("delete dir {path}: {e}"))
}

/// Create a directory (and all parents) at `path` within `root`.
#[tauri::command]
pub async fn saf_create_dir(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<(), String> {
    let root_uri = parse_root(&root)?;
    let api = app.android_fs_async();
    api.create_dir_all(&root_uri, clean_rel(&path))
        .await
        .map(|_| ())
        .map_err(|e| format!("create dir {path}: {e}"))
}

/// Rename or move a file/directory from `old_path` to `new_path` within `root`.
///
/// SAF's native rename only changes an entry's name within the same parent.
/// When the parent directory is unchanged we use it directly; a cross-directory
/// move is implemented as copy-then-delete and is currently supported for files
/// only (directory moves return an error).
#[tauri::command]
pub async fn saf_rename(
    app: tauri::AppHandle,
    root: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let root_uri = parse_root(&root)?;
    let old_rel = clean_rel(&old_path);
    let new_rel = clean_rel(&new_path);
    let (old_parent, _) = split_parent(old_rel);
    let (new_parent, new_name) = split_parent(new_rel);
    let api = app.android_fs_async();

    // Same parent directory → a pure rename.
    if old_parent == new_parent {
        if let Ok(file) = api.resolve_file_uri(&root_uri, old_rel).await {
            return api
                .rename(&file, new_name)
                .await
                .map(|_| ())
                .map_err(|e| format!("rename {old_path}: {e}"));
        }
        let dir = api
            .resolve_dir_uri(&root_uri, old_rel)
            .await
            .map_err(|e| format!("resolve {old_path}: {e}"))?;
        return api
            .rename(&dir, new_name)
            .await
            .map(|_| ())
            .map_err(|e| format!("rename {old_path}: {e}"));
    }

    // Cross-directory move — files only, via copy + delete.
    let src = api
        .resolve_file_uri(&root_uri, old_rel)
        .await
        .map_err(|_| format!("move {old_path}: directory moves are not supported"))?;
    let bytes = api
        .read(&src)
        .await
        .map_err(|e| format!("move read {old_path}: {e}"))?;
    let dest = api
        .create_new_file(&root_uri, new_rel, mime_for(new_rel))
        .await
        .map_err(|e| format!("move create {new_path}: {e}"))?;
    api.write(&dest, &bytes)
        .await
        .map_err(|e| format!("move write {new_path}: {e}"))?;
    api.remove_file(&src)
        .await
        .map_err(|e| format!("move delete {old_path}: {e}"))
}

/// List entries in `path` within `root`. When `recursive` is true, walks the
/// whole subtree and returns every entry with its path relative to `path`.
#[tauri::command]
pub async fn saf_list(
    app: tauri::AppHandle,
    root: String,
    path: String,
    recursive: bool,
) -> Result<Vec<SafEntry>, String> {
    let root_uri = parse_root(&root)?;
    let rel = clean_rel(&path);
    let api = app.android_fs_async();

    // Resolve the directory to start from (root itself when path is empty).
    let start = if rel.is_empty() {
        root_uri
    } else {
        api.resolve_dir_uri(&root_uri, rel)
            .await
            .map_err(|e| format!("resolve {path}: {e}"))?
    };

    let mut out: Vec<SafEntry> = Vec::new();
    // Iterative walk (avoids boxing async recursion). Each frame is the
    // directory URI plus its path prefix. The prefix is seeded with the listed
    // path so returned entry paths are relative to the workspace ROOT — matching
    // the desktop adapter's contract (e.g. listing "notes" yields "notes/foo").
    let mut stack: Vec<(FileUri, String)> = vec![(start, rel.to_string())];

    while let Some((dir_uri, prefix)) = stack.pop() {
        let entries = api
            .read_dir(&dir_uri)
            .await
            .map_err(|e| format!("read dir '{prefix}': {e}"))?;

        for entry in entries {
            let (name, is_dir, last_modified, uri) = match entry {
                Entry::File {
                    name,
                    last_modified,
                    uri,
                    ..
                } => (name, false, to_millis(last_modified), uri),
                Entry::Dir {
                    name,
                    last_modified,
                    uri,
                    ..
                } => (name, true, to_millis(last_modified), uri),
            };

            let child_path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };

            out.push(SafEntry {
                path: child_path.clone(),
                name,
                is_directory: is_dir,
                last_modified,
            });

            if is_dir && recursive {
                stack.push((uri, child_path));
            }
        }
    }

    Ok(out)
}

/// Check whether the persisted SAF permission for a workspace `root` is still
/// valid (read+write). Returns `false` when the grant is gone — e.g. after an
/// app reinstall (new UID), the user revoking access in system Settings, hitting
/// Android's persisted-URI limit, or a backup restored onto a different device.
///
/// The frontend uses this on workspace activation to prompt the user to re-pick
/// the folder instead of letting file I/O fail with an opaque `Permission
/// Denial` deep in the sync engine. A bare-URI (pre-FileUri-JSON) root has no
/// `documentTopTreeUri`, so it can never carry a valid tree grant → `false`.
#[tauri::command]
pub async fn saf_check_permission(
    app: tauri::AppHandle,
    root: String,
) -> Result<bool, String> {
    let root_uri = parse_root(&root)?;
    app.android_fs_async()
        .file_picker()
        .check_persisted_uri_permission(&root_uri, UriPermission::ReadAndWrite)
        .await
        .map_err(|e| format!("check permission: {e}"))
}

/// Best-effort MIME type from a file extension, defaulting to plain text.
fn mime_for(rel: &str) -> Option<&'static str> {
    let ext = rel.rsplit('.').next().unwrap_or("");
    Some(match ext.to_ascii_lowercase().as_str() {
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "csv" => "text/csv",
        _ => "text/plain",
    })
}
