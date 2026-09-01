use std::sync::Mutex;

use picoflow_flash::PicoVolume;
use tauri::State;

use crate::error::AppError;
use crate::session::{LastVolume, Session};

/// List mounted `RPI-RP2` / `CIRCUITPY` volumes and remember them for later path checks.
#[tauri::command]
pub fn list_pico_volumes(session: State<'_, Mutex<Session>>) -> Result<Vec<PicoVolume>, AppError> {
    let volumes = picoflow_flash::list_pico_volumes()?;
    let mut session = session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    session.last_volumes = volumes
        .iter()
        .map(|v| LastVolume {
            id: v.id.clone(),
            path: v.path.clone(),
        })
        .collect();
    Ok(volumes)
}
