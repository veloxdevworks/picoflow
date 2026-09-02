use std::path::{Path, PathBuf};

use crate::error::AppError;

const BLOCKED_VOLUME_LABELS: &[&str] = &["RPI-RP2", "CIRCUITPY"];

/// Session-scoped path sandbox used by later commands.
///
/// Commands must only touch `project_dir`, paths from the last native dialog,
/// and volumes from the last scan.
#[derive(Debug, Clone, Default)]
pub struct Session {
    pub project_dir: Option<PathBuf>,
    /// True while the open project lives under a `picoflow-untitled-*` temp dir.
    pub untitled: bool,
    pub last_dialog_paths: Vec<PathBuf>,
    pub last_volumes: Vec<LastVolume>,
}

/// Volume identity remembered from the last `list_pico_volumes` scan.
#[derive(Debug, Clone)]
pub struct LastVolume {
    pub id: String,
    pub path: PathBuf,
    pub kind: picoflow_flash::VolumeKind,
    pub writable: bool,
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

    /// Volume must have been returned by the last `list_pico_volumes` scan.
    pub fn require_volume(&self, volume_id: &str) -> Result<&LastVolume, AppError> {
        self.last_volumes
            .iter()
            .find(|v| v.id == volume_id)
            .ok_or_else(|| {
                AppError::path_not_allowed(format!(
                    "volume {volume_id} is not from the last list_pico_volumes scan"
                ))
            })
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

    /// No `asset:` scope for Pico MSC mounts (design: JS must not touch `/Volumes`).
    pub fn refuse_volume_dest(&self, dest: &Path) -> Result<(), AppError> {
        if is_blocked_volume_path(dest) {
            return Err(AppError::path_not_allowed(format!(
                "path {} is a Pico volume (RPI-RP2/CIRCUITPY are not asset-protocol dests)",
                dest.display()
            )));
        }
        for volume in &self.last_volumes {
            if dest_is_under(dest, &volume.path) {
                return Err(AppError::path_not_allowed(format!(
                    "path {} is under the last volume scan ({})",
                    dest.display(),
                    volume.path.display()
                )));
            }
        }
        Ok(())
    }
}

pub fn is_blocked_volume_path(path: &Path) -> bool {
    path.ancestors().any(|ancestor| {
        ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_blocked_volume_label)
    })
}

fn is_blocked_volume_label(name: &str) -> bool {
    BLOCKED_VOLUME_LABELS
        .iter()
        .any(|label| name.eq_ignore_ascii_case(label))
}

fn dest_is_under(dest: &Path, root: &Path) -> bool {
    let dest = canonicalize_dest(dest).unwrap_or_else(|_| dest.to_path_buf());
    let root = if root.exists() {
        std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
    } else {
        root.to_path_buf()
    };
    dest == root || dest.starts_with(&root)
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

    #[test]
    fn refuse_pico_volume_labels() {
        let session = Session::default();
        for dest in [
            Path::new("/Volumes/RPI-RP2"),
            Path::new("/Volumes/CIRCUITPY/sequence.json"),
            Path::new("/media/user/circuitpy/foo.picoflow"),
            Path::new("/run/media/user/rpi-rp2"),
        ] {
            let err = session.refuse_volume_dest(dest).unwrap_err();
            assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);
        }
        session
            .refuse_volume_dest(&std::env::temp_dir().join("Demo.picoflow"))
            .expect("temp dest is not a volume");
    }

    #[test]
    fn refuse_last_volume_scan_paths() {
        let volume = std::env::temp_dir().join(format!(
            "picoflow-fake-vol-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&volume).unwrap();
        let mut session = Session::default();
        session.last_volumes.push(LastVolume {
            id: volume.to_string_lossy().into_owned(),
            path: volume.clone(),
            kind: picoflow_flash::VolumeKind::Circuitpy,
            writable: true,
        });
        let err = session
            .refuse_volume_dest(&volume.join("sequence.json"))
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);
        let _ = std::fs::remove_dir_all(&volume);
    }

    #[test]
    fn require_volume_matches_last_scan_id() {
        let mut session = Session::default();
        session.last_volumes.push(LastVolume {
            id: "/Volumes/RPI-RP2".into(),
            path: PathBuf::from("/Volumes/RPI-RP2"),
            kind: picoflow_flash::VolumeKind::RpiRp2,
            writable: true,
        });
        let got = session.require_volume("/Volumes/RPI-RP2").unwrap();
        assert_eq!(got.kind, picoflow_flash::VolumeKind::RpiRp2);
        let err = session.require_volume("/Volumes/CIRCUITPY").unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);
    }
}
