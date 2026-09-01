use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;

use picoflow_core::{Photo, PhotoId, Point};
use picoflow_image::{decode_path, save_oriented, DetectResult};
use tauri::State;

use crate::error::AppError;
use crate::session::Session;

#[tauri::command(rename_all = "camelCase")]
pub async fn import_photos(
    session: State<'_, Mutex<Session>>,
    paths: Vec<String>,
) -> Result<Vec<Photo>, AppError> {
    let (project_dir, paths) = {
        let session = lock_session(&session)?;
        let project_dir = require_project_dir(&session)?;
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        ensure_import_paths(&session, &paths)?;
        (project_dir, paths)
    };

    tauri::async_runtime::spawn_blocking(move || import_photos_inner(&project_dir, &paths))
        .await
        .map_err(|_| AppError::io("image worker failed"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn detect_screen_quad(
    session: State<'_, Mutex<Session>>,
    photo_id: String,
) -> Result<DetectResult, AppError> {
    let project_dir = {
        let session = lock_session(&session)?;
        require_project_dir(&session)?
    };
    let id = parse_photo_id(&photo_id)?;
    let raw = raw_photo_path(&project_dir, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let oriented = decode_path(&raw)?;
        Ok(picoflow_image::detect_screen_quad(&oriented.pixels))
    })
    .await
    .map_err(|_| AppError::io("image worker failed"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn warp_photo(
    session: State<'_, Mutex<Session>>,
    photo_id: String,
    corners: [Point; 4],
) -> Result<Photo, AppError> {
    let project_dir = {
        let session = lock_session(&session)?;
        require_project_dir(&session)?
    };
    let id = parse_photo_id(&photo_id)?;
    let raw = raw_photo_path(&project_dir, &id)?;
    let image_corners = [
        picoflow_image::Point::new(corners[0].x, corners[0].y),
        picoflow_image::Point::new(corners[1].x, corners[1].y),
        picoflow_image::Point::new(corners[2].x, corners[2].y),
        picoflow_image::Point::new(corners[3].x, corners[3].y),
    ];

    tauri::async_runtime::spawn_blocking(move || {
        warp_photo_inner(&project_dir, id, &raw, image_corners, corners)
    })
    .await
    .map_err(|_| AppError::io("image worker failed"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_photo_bytes(
    session: State<'_, Mutex<Session>>,
    relative_path: String,
) -> Result<Vec<u8>, AppError> {
    let project_dir = {
        let session = lock_session(&session)?;
        require_project_dir(&session)?
    };
    let path = resolve_project_photo(&project_dir, &relative_path)?;
    tauri::async_runtime::spawn_blocking(move || std::fs::read(path).map_err(AppError::from))
        .await
        .map_err(|_| AppError::io("image worker failed"))?
}

fn import_photos_inner(project_dir: &Path, paths: &[PathBuf]) -> Result<Vec<Photo>, AppError> {
    let raw_dir = project_dir.join("photos/raw");
    std::fs::create_dir_all(&raw_dir)?;
    ensure_dir_under_project(project_dir, &raw_dir)?;

    let mut photos = Vec::with_capacity(paths.len());
    for src in paths {
        let oriented = decode_path(src)?;
        let id = PhotoId::new();
        let rel = format!("photos/raw/{id}.{}", oriented.source_format.raw_extension());
        let dest = project_dir.join(&rel);
        save_oriented(&oriented, &dest)?;
        photos.push(Photo {
            id,
            raw_path: rel,
            warped_path: None,
            corners: None,
            normalized: false,
            width: oriented.width(),
            height: oriented.height(),
            warped_width: None,
            warped_height: None,
        });
    }
    Ok(photos)
}

fn warp_photo_inner(
    project_dir: &Path,
    id: PhotoId,
    raw: &Path,
    image_corners: [picoflow_image::Point; 4],
    corners: [Point; 4],
) -> Result<Photo, AppError> {
    let oriented = decode_path(raw)?;
    let warped = picoflow_image::warp_quad(&oriented.pixels, image_corners)?;
    let warped_dir = project_dir.join("photos/warped");
    std::fs::create_dir_all(&warped_dir)?;
    ensure_dir_under_project(project_dir, &warped_dir)?;
    let rel = format!("photos/warped/{id}.png");
    let dest = project_dir.join(&rel);
    warped.save(&dest).map_err(picoflow_image::Error::from)?;

    let raw_rel = raw_relative_path(raw, id);
    Ok(Photo {
        id,
        raw_path: raw_rel,
        warped_path: Some(rel),
        corners: Some(corners),
        normalized: true,
        width: oriented.width(),
        height: oriented.height(),
        warped_width: Some(warped.width()),
        warped_height: Some(warped.height()),
    })
}

fn raw_relative_path(raw: &Path, id: PhotoId) -> String {
    let ext = raw.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    format!("photos/raw/{id}.{ext}")
}

fn lock_session(session: &Mutex<Session>) -> Result<std::sync::MutexGuard<'_, Session>, AppError> {
    session
        .lock()
        .map_err(|_| AppError::io("session lock poisoned"))
}

fn require_project_dir(session: &Session) -> Result<PathBuf, AppError> {
    session
        .project_dir
        .clone()
        .ok_or_else(|| AppError::path_not_allowed("no project is open"))
}

fn ensure_import_paths(session: &Session, paths: &[PathBuf]) -> Result<(), AppError> {
    if paths.len() != session.last_dialog_paths.len()
        || !paths
            .iter()
            .zip(&session.last_dialog_paths)
            .all(|(a, b)| paths_match(a, b))
    {
        return Err(AppError::path_not_allowed(
            "import paths must equal the last dialog selection",
        ));
    }
    Ok(())
}

fn paths_match(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn parse_photo_id(photo_id: &str) -> Result<PhotoId, AppError> {
    PhotoId::from_str(photo_id).map_err(|_| AppError::not_found("invalid photo id"))
}

fn raw_photo_path(project_dir: &Path, photo_id: &PhotoId) -> Result<PathBuf, AppError> {
    let id = photo_id.to_string();
    for ext in ["jpg", "jpeg", "png"] {
        let rel = format!("photos/raw/{id}.{ext}");
        let candidate = project_dir.join(&rel);
        if candidate.exists() {
            return resolve_project_photo(project_dir, &rel);
        }
    }
    Err(AppError::not_found(format!("raw photo {id} not found")))
}

fn relative_is_safe(relative: &str) -> bool {
    let path = Path::new(relative);
    if path.is_absolute() || relative.is_empty() {
        return false;
    }
    let mut comps = path.components();
    matches!(
        (comps.next(), comps.next(), comps.next(), comps.next()),
        (
            Some(Component::Normal(photos)),
            Some(Component::Normal(kind)),
            Some(Component::Normal(file)),
            None,
        ) if photos == "photos"
            && (kind == "raw" || kind == "warped")
            && !file.is_empty()
            && file != "."
    )
}

fn resolve_project_photo(project_dir: &Path, relative: &str) -> Result<PathBuf, AppError> {
    if !relative_is_safe(relative) {
        return Err(AppError::path_not_allowed(
            "path must be photos/raw/* or photos/warped/*",
        ));
    }
    let project = project_dir.canonicalize().map_err(AppError::from)?;
    let joined = project.join(relative);
    let canon = joined.canonicalize().map_err(AppError::from)?;
    if !canon.starts_with(&project) {
        return Err(AppError::path_not_allowed(
            "path is outside the current project",
        ));
    }
    Ok(canon)
}

fn ensure_dir_under_project(project_dir: &Path, dir: &Path) -> Result<(), AppError> {
    let project = project_dir.canonicalize().map_err(AppError::from)?;
    let dir = dir.canonicalize().map_err(AppError::from)?;
    if !dir.starts_with(&project) {
        return Err(AppError::path_not_allowed(
            "path is outside the current project",
        ));
    }
    Ok(())
}

impl From<picoflow_image::Error> for AppError {
    fn from(err: picoflow_image::Error) -> Self {
        match err {
            picoflow_image::Error::UnsupportedImage(msg) => AppError::unsupported_image(msg),
            picoflow_image::Error::Io(e) => AppError::from(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal() {
        assert!(!relative_is_safe("../secret.jpg"));
        assert!(!relative_is_safe("photos/raw/../../etc/passwd"));
        assert!(!relative_is_safe("/tmp/x.jpg"));
        assert!(!relative_is_safe("photos/raw/"));
        assert!(relative_is_safe("photos/raw/abc.jpg"));
        assert!(relative_is_safe("photos/warped/abc.png"));
    }

    #[test]
    fn import_paths_must_match_dialog() {
        let session = Session {
            project_dir: Some(PathBuf::from("/tmp/proj")),
            last_dialog_paths: vec![PathBuf::from("/tmp/a.jpg")],
            last_volumes: vec![],
        };
        let err = ensure_import_paths(&session, &[PathBuf::from("/tmp/b.jpg")]).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);
        ensure_import_paths(&session, &[PathBuf::from("/tmp/a.jpg")]).expect("same path string");
    }
}
