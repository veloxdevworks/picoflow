use std::path::{Path, PathBuf};
use std::sync::Mutex;

use picoflow_core::{parse_project, to_sequence, Project, Sequence, PROJECT_SCHEMA_VERSION};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::session::{canonicalize_dest, name_from_dir, Session};

const PROJECT_JSON: &str = "project.json";
const PHOTOS_DIR: &str = "photos";
const RAW_DIR: &str = "raw";
const WARPED_DIR: &str = "warped";

fn lock_session(session: &Mutex<Session>) -> std::sync::MutexGuard<'_, Session> {
    session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), AppError> {
    let mut json = serde_json::to_string_pretty(value)
        .map_err(|err| AppError::io(format!("serialize json: {err}")))?;
    json.push('\n');
    std::fs::write(path, json)?;
    Ok(())
}

pub fn empty_project(name: String) -> Project {
    Project {
        version: PROJECT_SCHEMA_VERSION,
        name,
        target: picoflow_core::Target::default(),
        photos: Vec::new(),
        clips: Vec::new(),
        actions: Vec::new(),
    }
}

pub fn init_project_dirs(dir: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dir.join(PHOTOS_DIR).join(RAW_DIR))?;
    std::fs::create_dir_all(dir.join(PHOTOS_DIR).join(WARPED_DIR))?;
    Ok(())
}

pub fn write_project_json(dir: &Path, project: &Project) -> Result<(), AppError> {
    project.validate_actions()?;
    write_json(&dir.join(PROJECT_JSON), project)
}

pub fn read_project_json(dir: &Path) -> Result<Project, AppError> {
    let path = dir.join(PROJECT_JSON);
    let json = std::fs::read_to_string(&path)?;
    Ok(parse_project(&json)?)
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

/// Switch asset-protocol scope to `dest`, forbidding the previous project dir first.
pub fn set_active_project(
    app: &AppHandle,
    session: &mut Session,
    dest: PathBuf,
) -> Result<(), AppError> {
    let scope = app.asset_protocol_scope();
    if let Some(prev) = session.project_dir.as_ref() {
        if prev != &dest {
            if let Err(err) = scope.forbid_directory(prev, true) {
                tracing::warn!(
                    path = %prev.display(),
                    error = %err,
                    "failed to forbid previous project dir"
                );
            }
        }
    }
    scope
        .allow_directory(&dest, true)
        .map_err(|err| AppError::io(format!("asset protocol allow_directory: {err}")))?;
    session.project_dir = Some(dest);
    Ok(())
}

fn record_and_require_dest(session: &mut Session, dest_dir: &str) -> Result<PathBuf, AppError> {
    let dest = canonicalize_dest(Path::new(dest_dir))?;
    session.record_dialog_paths([dest.clone()]);
    session.require_dialog_dest(&dest)
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    dest_dir: String,
    name: String,
) -> Result<Project, AppError> {
    let mut session = lock_session(&session);
    let dest = record_and_require_dest(&mut session, &dest_dir)?;
    let name = if name.trim().is_empty() {
        name_from_dir(&dest)
    } else {
        name
    };
    let project = empty_project(name);
    init_project_dirs(&dest)?;
    write_project_json(&dest, &project)?;
    set_active_project(&app, &mut session, dest)?;
    Ok(project)
}

#[tauri::command]
pub fn load_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    project_dir: String,
) -> Result<Project, AppError> {
    let mut session = lock_session(&session);
    let dest = record_and_require_dest(&mut session, &project_dir)?;
    let project = read_project_json(&dest)?;
    set_active_project(&app, &mut session, dest)?;
    Ok(project)
}

#[tauri::command]
pub fn save_project(session: State<'_, Mutex<Session>>, project: Project) -> Result<(), AppError> {
    let session = lock_session(&session);
    let dir = session.require_project_dir()?;
    write_project_json(dir, &project)
}

#[tauri::command]
pub fn duplicate_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    dest_dir: String,
) -> Result<Project, AppError> {
    let mut session = lock_session(&session);
    let src = session.require_project_dir()?.to_path_buf();
    let dest = record_and_require_dest(&mut session, &dest_dir)?;
    if dest == src {
        return Err(AppError::path_not_allowed(
            "duplicate dest must differ from the open project",
        ));
    }

    let mut project = read_project_json(&src)?;
    project.name = name_from_dir(&dest);
    init_project_dirs(&dest)?;
    let photos = src.join(PHOTOS_DIR);
    if photos.is_dir() {
        copy_dir_all(&photos, &dest.join(PHOTOS_DIR))?;
    }
    write_project_json(&dest, &project)?;
    set_active_project(&app, &mut session, dest)?;
    Ok(project)
}

#[tauri::command]
pub fn export_sequence(project: Project) -> Result<Sequence, AppError> {
    Ok(to_sequence(&project)?)
}

pub fn write_sequence_to_dest(dest: &Path, sequence: &Sequence) -> Result<(), AppError> {
    sequence.validate_events()?;
    write_json(dest, sequence)
}

#[tauri::command]
pub async fn write_sequence_file(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    sequence: Sequence,
) -> Result<(), AppError> {
    sequence.validate_events()?;
    let picked = app
        .dialog()
        .file()
        .set_file_name("sequence.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .ok_or_else(|| AppError::canceled("export canceled"))?;
    let dest = picked
        .into_path()
        .map_err(|err| AppError::path_not_allowed(err.to_string()))?;
    let dest = canonicalize_dest(&dest)?;

    let mut session = lock_session(&session);
    session.record_dialog_paths([dest.clone()]);
    let dest = session.require_dialog_dest(&dest)?;
    drop(session);

    write_sequence_to_dest(&dest, &sequence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use picoflow_core::parse_sequence;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "picoflow-project-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_write_load_round_trip() {
        let dest = temp_dir("create").join("Demo.picoflow");
        let project = empty_project("Demo".into());
        init_project_dirs(&dest).unwrap();
        write_project_json(&dest, &project).unwrap();
        let loaded = read_project_json(&dest).unwrap();
        assert_eq!(loaded.name, "Demo");
        assert_eq!(loaded.version, PROJECT_SCHEMA_VERSION);
        assert!(dest.join("photos/raw").is_dir());
        assert!(dest.join("photos/warped").is_dir());
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }

    #[test]
    fn duplicate_keeps_ids_and_changes_name() {
        let src = temp_dir("dup-src").join("Original.picoflow");
        let dest = src.parent().unwrap().join("Copy.picoflow");
        let mut project = parse_project(include_str!(
            "../../../crates/picoflow-core/tests/fixtures/project_v1.json"
        ))
        .unwrap();
        init_project_dirs(&src).unwrap();
        std::fs::write(src.join("photos/raw/note.txt"), b"raw").unwrap();
        write_project_json(&src, &project).unwrap();

        project.name = name_from_dir(&dest);
        init_project_dirs(&dest).unwrap();
        copy_dir_all(&src.join("photos"), &dest.join("photos")).unwrap();
        write_project_json(&dest, &project).unwrap();

        let copied = read_project_json(&dest).unwrap();
        let original = read_project_json(&src).unwrap();
        assert_eq!(copied.name, "Copy");
        assert_ne!(copied.name, original.name);
        assert_eq!(copied.photos[0].id, original.photos[0].id);
        assert_eq!(copied.clips[0].id, original.clips[0].id);
        assert_eq!(copied.actions[0].id, original.actions[0].id);
        assert_eq!(
            std::fs::read(dest.join("photos/raw/note.txt")).unwrap(),
            b"raw"
        );
        let _ = std::fs::remove_dir_all(src.parent().unwrap());
    }

    #[test]
    fn write_sequence_emits_snake_case() {
        let dest = temp_dir("seq").join("sequence.json");
        let project = parse_project(include_str!(
            "../../../crates/picoflow-core/tests/fixtures/project_v1.json"
        ))
        .unwrap();
        let sequence = to_sequence(&project).unwrap();
        write_sequence_to_dest(&dest, &sequence).unwrap();
        let text = std::fs::read_to_string(&dest).unwrap();
        assert!(text.contains("\"run_mode\""));
        assert!(text.contains("\"at_ms\""));
        assert!(!text.contains("\"atMs\""));
        let parsed = parse_sequence(&text).unwrap();
        assert_eq!(parsed.version, picoflow_core::SEQUENCE_SCHEMA_VERSION);
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }

    #[test]
    fn save_rejects_invalid_action() {
        let dest = temp_dir("invalid").join("Bad.picoflow");
        init_project_dirs(&dest).unwrap();
        let mut project = empty_project("Bad".into());
        project.actions = vec![picoflow_core::Action {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap(),
            at_ms: 0,
            kind: picoflow_core::ActionKind::Key {
                keycode: None,
                chars: None,
                modifiers: None,
                hold_ms: 50,
            },
        }];
        let err = write_project_json(&dest, &project).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::InvalidAction);
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }
}
