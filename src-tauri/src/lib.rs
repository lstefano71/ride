mod conn;
mod tls;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(conn::Conns::default())
        .invoke_handler(tauri::generate_handler![
            conn::conn_connect,
            conn::conn_send,
            conn::conn_close,
            conn::conn_abort,
            conn::conn_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RIDE");
}
