//! `D.host.sys`: process facts and the calls that act on the app or a window.
//!
//! The facts are a snapshot taken at startup and injected into every page before its
//! scripts run, so the frontend reads them synchronously (`window.__RIDE_SYS__`).

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    env: HashMap<String, String>,
    argv: Vec<String>,
    platform: &'static str,
    arch: &'static str,
    pid: u32,
    versions: HashMap<&'static str, String>,
    locale: String,
    temp_dir: String,
}

/// Node's names for the platform and architecture, as Electron reports them.
fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        os => os,
    }
}

fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "x86" => "ia32",
        "aarch64" => "arm64",
        a => a,
    }
}

/// The script that defines `window.__RIDE_SYS__` in every page.
pub fn init_script() -> String {
    let mut versions = HashMap::new();
    versions.insert("tauri", tauri::VERSION.to_string());
    if let Ok(v) = tauri::webview_version() {
        versions.insert("webview", v);
    }
    let temp = std::env::temp_dir().to_string_lossy().into_owned();
    let snapshot = Snapshot {
        env: std::env::vars_os()
            .map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned()))
            .collect(),
        argv: std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect(),
        platform: platform(),
        arch: arch(),
        pid: std::process::id(),
        versions,
        locale: sys_locale::get_locale().unwrap_or_else(|| "en-US".into()),
        temp_dir: temp.trim_end_matches(['/', '\\']).to_string(),
    };
    let json = serde_json::to_string(&snapshot).expect("sys snapshot serialises");
    format!("window.__RIDE_SYS__ = {json};")
}

fn window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(label).ok_or_else(|| format!("No window: {label}"))
}

/// Starts a new instance of RIDE with the same arguments; `env` overrides variables.
#[tauri::command]
pub fn sys_relaunch(env: HashMap<String, String>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .envs(env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sys_toggle_devtools<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let w = window(&app, &label)?;
    if w.is_devtools_open() {
        w.close_devtools();
    } else {
        w.open_devtools();
    }
    Ok(())
}

#[tauri::command]
pub fn sys_is_devtools_open<R: Runtime>(app: AppHandle<R>, label: String) -> Result<bool, String> {
    Ok(window(&app, &label)?.is_devtools_open())
}

#[tauri::command]
pub fn sys_print<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    window(&app, &label)?.print().map_err(|e| e.to_string())
}
