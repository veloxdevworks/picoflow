//! Pico volume listing and CIRCUITPY `picoflow.json` identity.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::platform;

/// Volume label for the RP2040 UF2 bootloader (case-sensitive).
pub const LABEL_RPI_RP2: &str = "RPI-RP2";
/// Volume label for CircuitPython MSC (case-sensitive).
pub const LABEL_CIRCUITPY: &str = "CIRCUITPY";

/// Injected mount enumerator so tests do not need a real Pico.
pub trait VolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>>;
}

/// A mounted volume as presented by the OS (label = directory name).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawVolume {
    pub label: String,
    pub path: PathBuf,
    pub writable: bool,
}

/// Treats `root` like `/Volumes`: children named by volume label.
#[derive(Debug, Clone)]
pub struct DirVolumeSource {
    pub root: PathBuf,
}

impl DirVolumeSource {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl VolumeSource for DirVolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>> {
        scan_volume_root(&self.root)
    }
}

/// Scan a directory whose immediate children are volume mount points.
pub(crate) fn scan_volume_root(root: &Path) -> io::Result<Vec<RawVolume>> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };

    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(label) = name.to_str() else {
            continue;
        };
        if label != LABEL_RPI_RP2 && label != LABEL_CIRCUITPY {
            continue;
        }
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let writable = path_writable(&path);
        out.push(RawVolume {
            label: label.to_string(),
            path,
            writable,
        });
    }
    out.sort_by(|a, b| a.label.cmp(&b.label).then(a.path.cmp(&b.path)));
    Ok(out)
}

#[cfg(unix)]
fn path_writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `c_path` is a valid C string for an existing directory.
    unsafe { libc::access(c_path.as_ptr(), libc::W_OK) == 0 }
}

#[cfg(not(unix))]
fn path_writable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|m| !m.permissions().readonly())
        .unwrap_or(false)
}

/// `RpiRp2` | `Circuitpy` as the UI/IPC enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VolumeKind {
    RpiRp2,
    Circuitpy,
}

/// HID profile stored in `picoflow.json` / `PicoVolume.picoflow`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HidProfile {
    AbsoluteMouseKeyboard,
    DigitizerKeyboard,
}

/// Runtime identity from CIRCUITPY `picoflow.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PicoflowIdentity {
    #[serde(rename = "runtimeVersion", alias = "runtime_version")]
    pub runtime_version: String,
    #[serde(rename = "hidProfile", alias = "hid_profile")]
    pub hid_profile: HidProfile,
}

/// A detected Pico mass-storage volume.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PicoVolume {
    /// Path, stable for the session.
    pub id: String,
    pub kind: VolumeKind,
    pub label: String,
    pub path: PathBuf,
    pub writable: bool,
    pub picoflow: Option<PicoflowIdentity>,
}

/// List `RPI-RP2` and `CIRCUITPY` volumes using the platform source.
pub fn list_pico_volumes() -> io::Result<Vec<PicoVolume>> {
    list_pico_volumes_with(&platform::default_source())
}

/// List Pico volumes from an injected [`VolumeSource`].
pub fn list_pico_volumes_with<S: VolumeSource>(source: &S) -> io::Result<Vec<PicoVolume>> {
    let raw = source.list_raw()?;
    let mut out = Vec::with_capacity(raw.len());
    for v in raw {
        let kind = match v.label.as_str() {
            LABEL_RPI_RP2 => VolumeKind::RpiRp2,
            LABEL_CIRCUITPY => VolumeKind::Circuitpy,
            _ => continue,
        };
        let picoflow = if kind == VolumeKind::Circuitpy {
            read_picoflow_cached(&v.path)
        } else {
            None
        };
        tracing::debug!(
            kind = ?kind,
            path = %v.path.display(),
            writable = v.writable,
            "pico volume"
        );
        out.push(PicoVolume {
            id: v.path.to_string_lossy().into_owned(),
            kind,
            label: v.label,
            path: v.path,
            writable: v.writable,
            picoflow,
        });
    }
    Ok(out)
}

struct CacheEntry {
    mtime: Option<SystemTime>,
    info: Option<PicoflowIdentity>,
}

fn picoflow_cache() -> &'static Mutex<HashMap<PathBuf, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_picoflow_cached(volume_path: &Path) -> Option<PicoflowIdentity> {
    let json_path = volume_path.join("picoflow.json");
    let mtime = fs::metadata(&json_path).and_then(|m| m.modified()).ok();

    {
        let cache = picoflow_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = cache.get(&json_path) {
            if entry.mtime.is_some() && entry.mtime == mtime {
                return entry.info.clone();
            }
        }
    }

    let info = fs::read(&json_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<PicoflowIdentity>(&bytes).ok());

    let mut cache = picoflow_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(
        json_path,
        CacheEntry {
            mtime,
            info: info.clone(),
        },
    );
    info
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn picoflow_cache_skips_reread_when_mtime_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("picoflow.json");
        fs::write(
            &path,
            r#"{"runtime_version":"0.1.0","hid_profile":"absolute_mouse_keyboard"}"#,
        )
        .unwrap();
        let mtime = fs::metadata(&path).unwrap().modified().unwrap();
        let first = read_picoflow_cached(dir.path());

        // Rewrite contents but restore mtime so a correct cache must not re-read.
        fs::write(
            &path,
            r#"{"runtime_version":"9.9.9","hid_profile":"digitizer_keyboard"}"#,
        )
        .unwrap();
        fs::File::open(&path).unwrap().set_modified(mtime).unwrap();

        let second = read_picoflow_cached(dir.path());
        assert_eq!(
            first,
            Some(PicoflowIdentity {
                runtime_version: "0.1.0".into(),
                hid_profile: HidProfile::AbsoluteMouseKeyboard,
            })
        );
        assert_eq!(first, second);
    }

    #[test]
    fn picoflow_cache_rereads_when_mtime_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("picoflow.json");
        fs::write(
            &path,
            r#"{"runtime_version":"0.1.0","hid_profile":"absolute_mouse_keyboard"}"#,
        )
        .unwrap();
        let first = read_picoflow_cached(dir.path());

        fs::write(
            &path,
            r#"{"runtime_version":"0.2.0","hid_profile":"digitizer_keyboard"}"#,
        )
        .unwrap();
        let file = fs::File::open(&path).unwrap();
        let new_mtime = SystemTime::now() + Duration::from_secs(2);
        file.set_modified(new_mtime).unwrap();

        let second = read_picoflow_cached(dir.path());
        assert_eq!(first.unwrap().runtime_version, "0.1.0");
        assert_eq!(
            second,
            Some(PicoflowIdentity {
                runtime_version: "0.2.0".into(),
                hid_profile: HidProfile::DigitizerKeyboard,
            })
        );
    }

    #[test]
    fn picoflow_io_or_parse_error_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_picoflow_cached(dir.path()).is_none());
        fs::write(dir.path().join("picoflow.json"), "not-json").unwrap();
        assert!(read_picoflow_cached(dir.path()).is_none());
    }

    #[test]
    fn picoflow_serializes_camel_case() {
        let id = PicoflowIdentity {
            runtime_version: "0.1.0".into(),
            hid_profile: HidProfile::AbsoluteMouseKeyboard,
        };
        let value = serde_json::to_value(&id).unwrap();
        assert_eq!(value["runtimeVersion"], "0.1.0");
        assert_eq!(value["hidProfile"], "absolute_mouse_keyboard");
    }
}
