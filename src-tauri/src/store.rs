//! `D.host.store`: the files RIDE keeps in its data folder, addressed by logical name.
//!
//! The folder is Electron's `userData` (`config_dir()/<productName>`), shared with the
//! Electron shell; see docs/adr/0002-shared-versioned-data-folder.md.

use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// `productName` from package.json, baked in by build.rs.
const PRODUCT_NAME: &str = env!("RIDE_PRODUCT_NAME");

fn data_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|d| d.join(PRODUCT_NAME))
        .ok_or_else(|| "No configuration folder on this system".into())
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn path(name: &str) -> Result<PathBuf, String> {
    Ok(match name {
        "prefs" => match env("RIDE_PREFS") {
            Some(p) => PathBuf::from(p),
            None => data_dir()?.join("prefs.json"),
        },
        "connections" => data_dir()?.join("connections.json"),
        "winstate" => data_dir()?.join(format!("{}.json", env("RIDE_CONF").as_deref().unwrap_or("winstate"))),
        "history" => data_dir()?.join("hist.txt"),
        _ => return Err(format!("Unknown store: {name}")),
    })
}

/// Modification time in whole milliseconds, like `+fs.statSync(f).mtime` in Node.
fn mtime(p: &PathBuf) -> Option<f64> {
    let t = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as f64)
}

#[derive(Serialize)]
pub struct Entry {
    text: String,
    mtime: Option<f64>,
}

/// The file's text and mtime, or `null` when it doesn't exist.
#[tauri::command]
pub fn store_read(name: String) -> Result<Option<Entry>, String> {
    let p = path(&name)?;
    match std::fs::read_to_string(&p) {
        Ok(text) => Ok(Some(Entry { text, mtime: mtime(&p) })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}

/// Replaces the file, creating the data folder if needed; returns the new mtime.
#[tauri::command]
pub fn store_write(name: String, text: String) -> Result<Option<f64>, String> {
    let p = path(&name)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    std::fs::write(&p, text).map_err(|e| format!("{}: {e}", p.display()))?;
    Ok(mtime(&p))
}

#[tauri::command]
pub fn store_mtime(name: String) -> Result<Option<f64>, String> {
    Ok(mtime(&path(&name)?))
}
