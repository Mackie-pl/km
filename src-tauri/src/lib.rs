mod saf;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// --- Platform Detection Command ---
// TypeScript analogy: This is like an API endpoint that returns the current OS.
// The `#[cfg(target_os = "...")]` is like a compile-time `if` — the compiler
// picks the right branch based on the target platform, so there's zero runtime
// overhead. Only the matching branch gets compiled into the binary.
#[tauri::command]
fn get_platform() -> &'static str {
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "android", target_os = "windows", target_os = "linux")))]
    {
        "unknown"
    }
}

#[tauri::command]
async fn pick_workspace_folder(
    app: tauri::AppHandle,
) -> Result<Option<WorkspaceInfo>, String> {
    // `pick_folder` / `blocking_pick_folder` are desktop-only in
    // tauri-plugin-dialog v2 — they're gated behind `#[cfg(desktop)]`,
    // so the method doesn't exist when compiling for Android/iOS.
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;

        let folder = app
            .dialog()
            .file()
            .blocking_pick_folder();

        match folder {
            Some(path) => {
                let path_str = path.to_string();
                register_fs_scope_inner(&app, &path_str, true)?;
                Ok(Some(WorkspaceInfo { path: path_str, name: None }))
            }
            None => Ok(None),
        }
    }

    // Android: no native filesystem-path folder picker exists (scoped storage).
    // Use the Storage Access Framework (ACTION_OPEN_DOCUMENT_TREE) via
    // tauri-plugin-android-fs, which returns a persistable content:// tree URI.
    // We persist the permission so the grant survives app/device restarts.
    //
    // NOTE: for now we return only the `uri` string as `path`. The full
    // FileUri ({ uri, documentTopTreeUri }) is needed for directory traversal
    // and will be threaded through in the URI-based Android adapter (step 2).
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;

        let api = app.android_fs_async();
        let picker = api.file_picker();
        let dir = picker
            .pick_dir(None, false)
            .await
            .map_err(|e| format!("Folder picker failed: {e}"))?;

        match dir {
            Some(uri) => {
                picker
                    .persist_uri_permission(&uri)
                    .await
                    .map_err(|e| format!("Failed to persist folder permission: {e}"))?;
                // Resolve the human-readable folder name from the document
                // provider; the content:// URI itself isn't user-presentable.
                let name = api.get_name_or_last_path_segment(&uri).await;
                // Persist the FULL FileUri (uri + documentTopTreeUri) as the
                // workspace root: the SAF plugin needs both fields to resolve
                // child entries. The Android adapter parses this back via
                // FileUri::from_json_str.
                let root_json = uri
                    .to_json_string()
                    .map_err(|e| format!("failed to serialize folder URI: {e}"))?;
                Ok(Some(WorkspaceInfo {
                    path: root_json,
                    name: Some(name),
                }))
            }
            None => Ok(None),
        }
    }

    #[cfg(not(any(desktop, target_os = "android")))]
    {
        let _ = &app;
        Err("Folder picking is not supported on this platform".to_string())
    }
}


/// Register a directory path with Tauri's FS scope so the frontend can
/// read/write files inside it.
///
/// Called on every `forcePull()` and `pickWorkspaceFolder()` so that
/// workspace paths loaded from config (localStorage) are also authorized.
///
/// TypeScript analogy: Like pre-authorizing a file handle via the File
/// System Access API's `showDirectoryPicker()` + `requestPermission()` —
/// but without the UI dialog.
#[tauri::command]
fn register_fs_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    register_fs_scope_inner(&app, &path, true)
}

/// Internal helper — registers a path with the FS scope.
fn register_fs_scope_inner(
    app: &tauri::AppHandle,
    path: &str,
    writable: bool,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    app.fs_scope()
        .allow_directory(path, writable)
        .map_err(|e| format!("Failed to register FS scope: {e}"))
}


// --- OAuth loopback (desktop Google sign-in) ---
// The webview can't host Google's consent page, so the frontend opens the
// SYSTEM browser to the PKCE auth URL with `redirect_uri=http://127.0.0.1:<port>`.
// This tiny one-shot server catches that redirect and hands the `code` back.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

/// Receiver for the captured authorization code, parked between
/// `oauth_loopback_start` and `oauth_loopback_wait`.
#[derive(Default)]
struct OAuthLoopback {
    rx: Mutex<Option<mpsc::Receiver<Result<String, String>>>>,
}

/// Pull the `code` (or surface an `error`) out of a request line such as
/// `GET /?code=abc&scope=... HTTP/1.1`.
fn parse_oauth_redirect(request_line: &str) -> Result<String, String> {
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split('?').nth(1).unwrap_or("");
    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("");
        let val = kv.next().unwrap_or("");
        match key {
            "code" => code = Some(url_decode(val)),
            "error" => error = Some(url_decode(val)),
            _ => {}
        }
    }
    if let Some(e) = error {
        return Err(format!("Google sign-in failed: {e}"));
    }
    code.ok_or_else(|| "No authorization code in redirect".to_string())
}

/// Minimal percent-decoding for the redirect query.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(b) => {
                    out.push(b);
                    i += 3;
                }
                Err(_) => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Bind a loopback server on a random port and return it. A background thread
/// accepts exactly one request (the OAuth redirect), replies with a small page,
/// and forwards the parsed code to `oauth_loopback_wait`.
#[tauri::command]
fn oauth_loopback_start(state: tauri::State<'_, OAuthLoopback>) -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind loopback: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    *state.rx.lock().unwrap() = Some(rx);

    std::thread::spawn(move || {
        let result = (|| -> Result<String, String> {
            let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
            let request = String::from_utf8_lossy(&buf[..n]);
            let parsed = parse_oauth_redirect(request.lines().next().unwrap_or(""));

            let body = "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:3rem\">\
                <h2>Sign-in complete</h2><p>You can close this window and return to the app.</p></body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            parsed
        })();
        let _ = tx.send(result);
    });

    Ok(port)
}

/// Block (on a worker, like `pick_workspace_folder`) until the loopback captures
/// the redirect, then return the authorization code.
#[tauri::command]
async fn oauth_loopback_wait(state: tauri::State<'_, OAuthLoopback>) -> Result<String, String> {
    let rx = state
        .rx
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "OAuth loopback not started".to_string())?;
    rx.recv_timeout(Duration::from_secs(300))
        .map_err(|_| "Timed out waiting for Google sign-in".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(OAuthLoopback::default())
        // Register commands so the frontend can invoke them via `invoke()`
        .invoke_handler(tauri::generate_handler![
            greet,
            get_platform,
            pick_workspace_folder,
            register_fs_scope,
            saf::saf_read,
            saf::saf_write,
            saf::saf_delete,
            saf::saf_create_dir,
            saf::saf_rename,
            saf::saf_list,
            saf::saf_check_permission,
            oauth_loopback_start,
            oauth_loopback_wait
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct WorkspaceInfo {
    path: String,
    /// Human-readable folder name. Populated on Android (where `path` is an
    /// opaque content:// URI the frontend can't derive a name from); `None`
    /// on desktop, where the frontend derives the name from the real path.
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

