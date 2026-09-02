use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::resources::{load_firmware_manifest, FirmwareManifest};

#[tauri::command]
pub fn get_firmware_manifest(app: AppHandle) -> Result<FirmwareManifest, AppError> {
    load_firmware_manifest(&app)
}

/// Reveal the Tauri AppLog directory (wizard Open log). No shell plugin.
#[tauri::command]
pub fn open_app_log(app: AppHandle) -> Result<(), AppError> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|err| AppError::io(format!("app log dir: {err}")))?;
    std::fs::create_dir_all(&log_dir)?;

    let result = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(&log_dir).status()
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer").arg(&log_dir).status()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Command::new("xdg-open").arg(&log_dir).status()
        }
    };

    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(AppError::io(format!(
            "open log dir {} failed: {status}",
            log_dir.display()
        ))),
        Err(err) => Err(AppError::io(format!(
            "open log dir {}: {err}",
            log_dir.display()
        ))),
    }
}
