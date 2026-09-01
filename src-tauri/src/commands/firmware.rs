use tauri::AppHandle;

use crate::error::AppError;
use crate::resources::{load_firmware_manifest, FirmwareManifest};

#[tauri::command]
pub fn get_firmware_manifest(app: AppHandle) -> Result<FirmwareManifest, AppError> {
    load_firmware_manifest(&app)
}
