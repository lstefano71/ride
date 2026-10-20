mod conn;
mod fs;
mod store;
mod sys;
mod tls;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // D.host.sys's snapshot, in every page before its scripts run
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("ride-sys")
                .js_init_script(sys::init_script())
                .build(),
        )
        .manage(conn::Conns::default())
        // Hidden auxiliary windows (prefs, dialog, status) would keep the app alive.
        .on_window_event(|w, e| {
            if w.label() == "main" && matches!(e, tauri::WindowEvent::Destroyed) {
                w.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            conn::conn_connect,
            conn::conn_send,
            conn::conn_close,
            conn::conn_abort,
            conn::conn_reset,
            store::store_read,
            store::store_write,
            store::store_mtime,
            sys::sys_relaunch,
            sys::sys_toggle_devtools,
            sys::sys_print,
            fs::fs_read_text,
            fs::fs_write_text,
            fs::fs_append_text,
            fs::fs_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RIDE");
}
