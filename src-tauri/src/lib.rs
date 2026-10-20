mod conn;
mod store;
mod tls;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running RIDE");
}
