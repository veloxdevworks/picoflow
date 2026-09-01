use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Session-scoped path sandbox used by later commands.
///
/// Commands must only touch `project_dir`, paths from the last native dialog,
/// and volumes from the last scan.
#[derive(Debug, Clone, Default)]
pub struct Session {
    pub project_dir: Option<PathBuf>,
    pub last_dialog_paths: Vec<PathBuf>,
    #[allow(dead_code)]
    pub last_volumes: Vec<LastVolume>,
}

/// Volume identity remembered from the last `list_pico_volumes` scan.
#[derive(Debug, Clone)]
pub struct LastVolume {
    pub id: String,
    pub path: PathBuf,
}

impl Session {
    pub fn record_dialog_paths(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        self.last_dialog_paths = paths.into_iter().collect();
    }

    pub fn require_project_dir(&self) -> Result<&Path, AppError> {
        self.project_dir
            .as_deref()
            .ok_or_else(|| AppError::path_not_allowed("no project directory in this session"))
    }

    /// Dest must equal a path from the last native dialog (after canonicalization).
    pub fn require_dialog_dest(&self, dest: &Path) -> Result<PathBuf, AppError> {
        let dest = canonicalize_dest(dest)?;
        let allowed = self.last_dialog_paths.iter().any(|recorded| {
            canonicalize_dest(recorded)
                .map(|path| path == dest)
                .unwrap_or(false)
        });
        if allowed {
            Ok(dest)
        } else {
            Err(AppError::path_not_allowed(format!(
                "path {} is not from the last dialog",
                dest.display()
            )))
        }
    }
}

/// Reject relative paths so JS cannot walk out of a dialog dest with `../`.
pub fn require_absolute(path: &Path) -> Result<(), AppError> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(AppError::path_not_allowed(format!(
            "path {} is not absolute",
            path.display()
        )))
    }
}

/// Canonicalize an existing path, or parent + basename when the dest does not exist yet.
pub fn canonicalize_dest(path: &Path) -> Result<PathBuf, AppError> {
    require_absolute(path)?;
    if path.exists() {
        return std::fs::canonicalize(path).map_err(AppError::from);
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| AppError::path_not_allowed(format!("invalid dest {}", path.display())))?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::path_not_allowed(format!("invalid dest {}", path.display())))?;
    if !parent.exists() {
        return Err(AppError::not_found(format!(
            "parent directory {} does not exist",
            parent.display()
        )));
    }
    let parent = std::fs::canonicalize(parent)?;
    Ok(parent.join(name))
}

pub fn name_from_dir(dir: &Path) -> String {
    dir.file_stem()
        .or_else(|| dir.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Untitled".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_dest() {
        let err = require_absolute(Path::new("foo/bar")).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);
    }

    #[test]
    fn require_dialog_dest_matches_recorded_path() {
        let dir = std::env::temp_dir();
        let dest = dir.join("picoflow-session-dialog.picoflow");
        let mut session = Session::default();
        session.record_dialog_paths([dest.clone()]);
        let got = session.require_dialog_dest(&dest).expect("recorded dest");
        assert_eq!(got, canonicalize_dest(&dest).unwrap());
    }

    #[test]
    fn require_dialog_dest_rejects_unknown_path() {
        let mut session = Session::default();
        session.record_dialog_paths([std::env::temp_dir().join("allowed.picoflow")]);
        let err = session
            .require_dialog_dest(&std::env::temp_dir().join("other.picoflow"))
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);
    }
}
