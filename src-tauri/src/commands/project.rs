use std::path::{Path, PathBuf};
use std::sync::Mutex;

use picoflow_core::{
    ensure_version, parse_project, to_sequence, Project, Sequence, PROJECT_SCHEMA_VERSION,
    SEQUENCE_SCHEMA_VERSION,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::AppError;
use crate::session::{canonicalize_dest, name_from_dir, Session};

/// Dialog dest flows *out* so JS can `convertFileSrc`; JS never supplies dest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub project: Project,
    pub project_dir: PathBuf,
    pub untitled: bool,
}

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
    ensure_version(project.version, PROJECT_SCHEMA_VERSION)?;
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

/// Grant asset-protocol reads under `dest`.
///
/// Do not `forbid_directory` the previous project: Tauri 2.11's forbid list is
/// sticky, so Open A → Open B → Open A would break `convertFileSrc` for A.
pub fn set_active_project(
    app: &AppHandle,
    session: &mut Session,
    dest: PathBuf,
) -> Result<(), AppError> {
    app.asset_protocol_scope()
        .allow_directory(&dest, true)
        .map_err(|err| AppError::io(format!("asset protocol allow_directory: {err}")))?;
    session.project_dir = Some(dest);
    Ok(())
}

fn opened(project: Project, dest: PathBuf, untitled: bool) -> OpenedProject {
    OpenedProject {
        project,
        project_dir: dest,
        untitled,
    }
}

const UNTITLED_PREFIX: &str = "picoflow-untitled-";

pub fn untitled_dir_name(id: &str) -> String {
    format!("{UNTITLED_PREFIX}{id}")
}

pub fn new_untitled_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{now}", std::process::id())
}

pub fn is_untitled_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(UNTITLED_PREFIX))
}

pub fn create_untitled_project(
    parent: &Path,
    id: &str,
    name: String,
) -> Result<(PathBuf, Project), AppError> {
    let dest = parent.join(untitled_dir_name(id));
    if dest.exists() {
        std::fs::remove_dir_all(&dest)?;
    }
    let project = empty_project(if name.trim().is_empty() {
        "Untitled".into()
    } else {
        name
    });
    init_project_dirs(&dest)?;
    write_project_json(&dest, &project)?;
    Ok((dest, project))
}

/// Move `src` to `dest`, copying across filesystems when rename is not possible.
pub fn relocate_project_dir(src: &Path, dest: &Path) -> Result<(), AppError> {
    if src == dest {
        return Ok(());
    }
    if dest.exists() {
        if dest.is_file() {
            std::fs::remove_file(dest)?;
        } else {
            std::fs::remove_dir_all(dest)?;
        }
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_all(src, dest)?;
            std::fs::remove_dir_all(src)?;
            Ok(())
        }
    }
}

pub fn save_untitled_as(src: &Path, dest: &Path, project: &mut Project) -> Result<(), AppError> {
    write_project_json(src, project)?;
    relocate_project_dir(src, dest)?;
    project.name = name_from_dir(dest);
    write_project_json(dest, project)?;
    Ok(())
}

fn discard_untitled_dir(dir: &Path) {
    if is_untitled_dir(dir) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

fn take_untitled_dir(session: &mut Session) -> Option<PathBuf> {
    if !session.untitled {
        return None;
    }
    session.untitled = false;
    session.project_dir.take()
}

fn app_temp_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .temp_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn dest_from_dialog(picked: FilePath) -> Result<PathBuf, AppError> {
    let dest = picked
        .into_path()
        .map_err(|err| AppError::path_not_allowed(err.to_string()))?;
    canonicalize_dest(&dest)
}

fn record_native_dest(session: &mut Session, dest: PathBuf) -> Result<PathBuf, AppError> {
    session.refuse_volume_dest(&dest)?;
    session.record_dialog_paths([dest.clone()]);
    session.require_dialog_dest(&dest)
}

fn default_picoflow_name(name: &str) -> String {
    let stem = Path::new(name.trim())
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Untitled");
    if stem.to_ascii_lowercase().ends_with(".picoflow") {
        stem.to_string()
    } else {
        format!("{stem}.picoflow")
    }
}

fn pick_save_picoflow(app: &AppHandle, default_name: &str) -> Result<PathBuf, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(default_picoflow_name(default_name))
        .add_filter("PicoFlow", &["picoflow"])
        .blocking_save_file()
        .ok_or_else(|| AppError::canceled("save canceled"))?;
    dest_from_dialog(picked)
}

fn pick_open_project_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let picked = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .ok_or_else(|| AppError::canceled("open canceled"))?;
    dest_from_dialog(picked)
}

fn pick_save_sequence(app: &AppHandle) -> Result<PathBuf, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_file_name("sequence.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .ok_or_else(|| AppError::canceled("export canceled"))?;
    dest_from_dialog(picked)
}

#[tauri::command]
pub async fn create_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    name: String,
) -> Result<OpenedProject, AppError> {
    let parent = app_temp_dir(&app);
    let (dest, project) = create_untitled_project(&parent, &new_untitled_id(), name)?;
    let mut session = lock_session(&session);
    let previous = take_untitled_dir(&mut session);
    set_active_project(&app, &mut session, dest.clone())?;
    session.untitled = true;
    drop(session);
    if let Some(previous) = previous {
        if previous != dest {
            discard_untitled_dir(&previous);
        }
    }
    Ok(opened(project, dest, true))
}

#[tauri::command]
pub async fn load_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
) -> Result<OpenedProject, AppError> {
    let dest = pick_open_project_dir(&app)?;
    let mut session = lock_session(&session);
    let dest = record_native_dest(&mut session, dest)?;
    let project = read_project_json(&dest)?;
    let previous = take_untitled_dir(&mut session);
    set_active_project(&app, &mut session, dest.clone())?;
    drop(session);
    if let Some(previous) = previous {
        if previous != dest {
            discard_untitled_dir(&previous);
        }
    }
    Ok(opened(project, dest, false))
}

#[tauri::command]
pub async fn save_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    mut project: Project,
) -> Result<OpenedProject, AppError> {
    let (untitled, dir) = {
        let session = lock_session(&session);
        let dir = session.require_project_dir()?.to_path_buf();
        (session.untitled, dir)
    };

    if !untitled {
        write_project_json(&dir, &project)?;
        return Ok(opened(project, dir, false));
    }

    let dest = pick_save_picoflow(&app, &project.name)?;
    let mut session = lock_session(&session);
    let dest = record_native_dest(&mut session, dest)?;
    if dest == dir {
        write_project_json(&dir, &project)?;
        session.untitled = false;
        return Ok(opened(project, dir, false));
    }
    save_untitled_as(&dir, &dest, &mut project)?;
    session.untitled = false;
    set_active_project(&app, &mut session, dest.clone())?;
    Ok(opened(project, dest, false))
}

#[tauri::command]
pub async fn duplicate_project(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
) -> Result<OpenedProject, AppError> {
    let (src, default_name) = {
        let session = lock_session(&session);
        let src = session.require_project_dir()?.to_path_buf();
        let project = read_project_json(&src)?;
        (src, format!("{}.picoflow", project.name))
    };
    let dest = pick_save_picoflow(&app, &default_name)?;
    let mut session = lock_session(&session);
    let dest = record_native_dest(&mut session, dest)?;
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
    let previous = take_untitled_dir(&mut session);
    set_active_project(&app, &mut session, dest.clone())?;
    drop(session);
    if let Some(previous) = previous {
        if previous != dest {
            discard_untitled_dir(&previous);
        }
    }
    Ok(opened(project, dest, false))
}

#[tauri::command]
pub fn export_sequence(project: Project) -> Result<Sequence, AppError> {
    Ok(to_sequence(&project)?)
}

pub fn write_sequence_to_dest(dest: &Path, sequence: &Sequence) -> Result<(), AppError> {
    ensure_version(sequence.version, SEQUENCE_SCHEMA_VERSION)?;
    sequence.validate_events()?;
    write_json(dest, sequence)
}

#[tauri::command]
pub async fn write_sequence_file(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    sequence: Sequence,
) -> Result<(), AppError> {
    ensure_version(sequence.version, SEQUENCE_SCHEMA_VERSION)?;
    sequence.validate_events()?;
    let dest = pick_save_sequence(&app)?;
    let mut session = lock_session(&session);
    let dest = record_native_dest(&mut session, dest)?;
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
    fn write_rejects_unsupported_versions() {
        let dest = temp_dir("version").join("Bad.picoflow");
        init_project_dirs(&dest).unwrap();
        let mut project = empty_project("Bad".into());
        project.version = 2;
        let err = write_project_json(&dest, &project).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::InvalidProject);

        let mut sequence = to_sequence(&empty_project("ok".into())).unwrap();
        sequence.version = 2;
        let err = write_sequence_to_dest(&dest.join("sequence.json"), &sequence).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::InvalidProject);
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }

    #[test]
    fn untitled_dir_has_expected_layout() {
        let parent = temp_dir("untitled-layout");
        let (dest, project) = create_untitled_project(&parent, "abc", String::new()).unwrap();
        assert_eq!(dest, parent.join("picoflow-untitled-abc"));
        assert!(is_untitled_dir(&dest));
        assert_eq!(project.name, "Untitled");
        assert!(dest.join("project.json").is_file());
        assert!(dest.join("photos/raw").is_dir());
        assert!(dest.join("photos/warped").is_dir());
        let loaded = read_project_json(&dest).unwrap();
        assert_eq!(loaded.name, "Untitled");
        assert_eq!(loaded.photos.len(), 0);
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn save_as_moves_untitled_and_renames() {
        let parent = temp_dir("untitled-save-as");
        let (src, mut project) = create_untitled_project(&parent, "move", String::new()).unwrap();
        std::fs::write(src.join("photos/raw/note.txt"), b"raw").unwrap();
        let dest = parent.join("Walkthrough.picoflow");

        save_untitled_as(&src, &dest, &mut project).unwrap();

        assert!(!src.exists());
        assert_eq!(project.name, "Walkthrough");
        assert!(dest.join("project.json").is_file());
        assert_eq!(
            std::fs::read(dest.join("photos/raw/note.txt")).unwrap(),
            b"raw"
        );
        let loaded = read_project_json(&dest).unwrap();
        assert_eq!(loaded.name, "Walkthrough");
        assert!(!is_untitled_dir(&dest));
        let _ = std::fs::remove_dir_all(&parent);
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
