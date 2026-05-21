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
    use tauri_plugin_dialog::DialogExt;

    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();

    match folder {
        Some(path) => Ok(Some(WorkspaceInfo {
            path: path.to_string(),
        })),
        None => Ok(None),
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init()) 
        // Register both commands so the frontend can invoke them via `invoke()`
        .invoke_handler(tauri::generate_handler![greet, get_platform, pick_workspace_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct WorkspaceInfo {
    path: String,
}

