//! `D.host.fs`: text files named by the user (protocol log, dropped workspaces,
//! `RIDE_JS`/`RIDE_CSS`, demo scripts). Relative paths resolve against the working
//! directory, as Node's `fs` does.

use std::io::Write;

fn err(path: &str, e: std::io::Error) -> String {
    format!("{path}: {e}")
}

#[tauri::command]
pub async fn fs_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| err(&path, e))
}

#[tauri::command]
pub async fn fs_write_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| err(&path, e))
}

#[tauri::command]
pub async fn fs_append_text(path: String, text: String) -> Result<(), String> {
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(text.as_bytes()))
        .map_err(|e| err(&path, e))
}

#[tauri::command]
pub async fn fs_remove(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(&path, e)),
        _ => Ok(()),
    }
}
