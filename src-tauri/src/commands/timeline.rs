use picoflow_core::{ClipId, Project};

use crate::error::AppError;

#[tauri::command]
pub fn ripple_clip(
    project: Project,
    clip_id: ClipId,
    new_duration_ms: u32,
) -> Result<Project, AppError> {
    Ok(picoflow_core::ripple_clip(
        project,
        clip_id,
        new_duration_ms,
    )?)
}

#[tauri::command]
pub fn reorder_clips(project: Project, ordered_clip_ids: Vec<ClipId>) -> Result<Project, AppError> {
    Ok(picoflow_core::reorder_clips(project, &ordered_clip_ids)?)
}

#[tauri::command]
pub fn insert_wait(project: Project, at_ms: u32, duration_ms: u32) -> Result<Project, AppError> {
    Ok(picoflow_core::insert_wait(project, at_ms, duration_ms)?)
}
