//! Pico volume listing and CIRCUITPY `picoflow.json` identity.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::platform;

/// Volume label for the RP2040 UF2 bootloader (case-sensitive).
pub const LABEL_RPI_RP2: &str = "RPI-RP2";
/// Volume label for CircuitPython MSC (case-sensitive).
pub const LABEL_CIRCUITPY: &str = "CIRCUITPY";
/// Wizard poll interval for BOOTSEL / post-UF2 CIRCUITPY waits.
pub const VOLUME_POLL_INTERVAL: Duration = Duration::from_millis(400);

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
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                tracing::debug!(error = %e, "skipping unreadable volume dirent");
                continue;
            }
        };
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
    prune_picoflow_cache();
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
    publish_volume_scan(&out);
    Ok(out)
}

/// Poll [`list_pico_volumes`] until a volume of `kind` appears or `timeout` elapses.
pub fn wait_for_volume(kind: VolumeKind, timeout: Duration) -> io::Result<PicoVolume> {
    wait_for_volume_with(&platform::default_source(), kind, timeout, |_| {})
}

/// Injected-source wait used by tests and the Tauri command (scan callback records session).
pub fn wait_for_volume_with<S, F>(
    source: &S,
    kind: VolumeKind,
    timeout: Duration,
    mut after_scan: F,
) -> io::Result<PicoVolume>
where
    S: VolumeSource,
    F: FnMut(&[PicoVolume]),
{
    let start = Instant::now();
    loop {
        let volumes = list_pico_volumes_with(source)?;
        after_scan(&volumes);
        if let Some(volume) = volumes.into_iter().find(|v| v.kind == kind) {
            return Ok(volume);
        }
        let elapsed = start.elapsed();
        if elapsed >= timeout {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("timed out waiting for {kind:?} volume"),
            ));
        }
        std::thread::sleep(VOLUME_POLL_INTERVAL.min(timeout.saturating_sub(elapsed)));
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VolumeSnap {
    path: PathBuf,
    kind: VolumeKind,
    writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum VolumeEvent {
    Added(VolumeSnap),
    Removed(VolumeSnap),
    Changed { from: VolumeSnap, to: VolumeSnap },
}

fn last_scan() -> &'static Mutex<Vec<VolumeSnap>> {
    static LAST: OnceLock<Mutex<Vec<VolumeSnap>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(Vec::new()))
}

fn snap_volume(v: &PicoVolume) -> VolumeSnap {
    VolumeSnap {
        path: v.path.clone(),
        kind: v.kind,
        writable: v.writable,
    }
}

fn diff_volume_snaps(prev: &[VolumeSnap], current: &[VolumeSnap]) -> Vec<VolumeEvent> {
    let mut events = Vec::new();
    for s in current {
        match prev.iter().find(|p| p.path == s.path) {
            None => events.push(VolumeEvent::Added(s.clone())),
            Some(old) if old != s => events.push(VolumeEvent::Changed {
                from: old.clone(),
                to: s.clone(),
            }),
            Some(_) => {}
        }
    }
    for old in prev {
        if !current.iter().any(|s| s.path == old.path) {
            events.push(VolumeEvent::Removed(old.clone()));
        }
    }
    events
}

fn publish_volume_scan(current: &[PicoVolume]) {
    let now: Vec<VolumeSnap> = current.iter().map(snap_volume).collect();
    let mut prev = last_scan()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for event in diff_volume_snaps(&prev, &now) {
        match event {
            VolumeEvent::Added(s) => {
                tracing::info!(
                    kind = ?s.kind,
                    path = %s.path.display(),
                    writable = s.writable,
                    "pico volume added"
                );
            }
            VolumeEvent::Removed(s) => {
                tracing::info!(
                    kind = ?s.kind,
                    path = %s.path.display(),
                    writable = s.writable,
                    "pico volume removed"
                );
            }
            VolumeEvent::Changed { to, .. } => {
                tracing::info!(
                    kind = ?to.kind,
                    path = %to.path.display(),
                    writable = to.writable,
                    "pico volume changed"
                );
            }
        }
    }
    *prev = now;
}

struct CacheEntry {
    mtime: Option<SystemTime>,
    len: u64,
    info: Option<PicoflowIdentity>,
}

fn picoflow_cache() -> &'static Mutex<HashMap<PathBuf, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_picoflow_cache() {
    let mut cache = picoflow_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.retain(|json_path, _| json_path.is_file());
}

fn read_picoflow_cached(volume_path: &Path) -> Option<PicoflowIdentity> {
    let json_path = volume_path.join("picoflow.json");
    let meta = fs::metadata(&json_path).ok();
    let mtime = meta.as_ref().and_then(|m| m.modified().ok());
    let len = meta.as_ref().map(|m| m.len()).unwrap_or(0);

    {
        let cache = picoflow_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = cache.get(&json_path) {
            if entry.mtime.is_some() && entry.mtime == mtime && entry.len == len {
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
            len,
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
        // Same byte length so a length-aware cache must still skip the reread.
        fs::write(
            &path,
            r#"{"runtime_version":"0.1.1","hid_profile":"absolute_mouse_keyboard"}"#,
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
    fn picoflow_cache_rereads_when_len_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("picoflow.json");
        fs::write(
            &path,
            r#"{"runtime_version":"0.1.0","hid_profile":"absolute_mouse_keyboard"}"#,
        )
        .unwrap();
        let mtime = fs::metadata(&path).unwrap().modified().unwrap();
        let first = read_picoflow_cached(dir.path());

        fs::write(
            &path,
            r#"{"runtime_version":"0.1.0","hid_profile":"digitizer_keyboard"}"#,
        )
        .unwrap();
        fs::File::open(&path).unwrap().set_modified(mtime).unwrap();

        let second = read_picoflow_cached(dir.path());
        assert_eq!(
            first.unwrap().hid_profile,
            HidProfile::AbsoluteMouseKeyboard
        );
        assert_eq!(
            second,
            Some(PicoflowIdentity {
                runtime_version: "0.1.0".into(),
                hid_profile: HidProfile::DigitizerKeyboard,
            })
        );
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
    fn volume_diff_reports_add_remove_and_writable_change() {
        let a = VolumeSnap {
            path: PathBuf::from("/Volumes/CIRCUITPY"),
            kind: VolumeKind::Circuitpy,
            writable: true,
        };
        let b = VolumeSnap {
            path: PathBuf::from("/Volumes/RPI-RP2"),
            kind: VolumeKind::RpiRp2,
            writable: true,
        };
        let a_ro = VolumeSnap {
            writable: false,
            ..a.clone()
        };

        assert_eq!(
            diff_volume_snaps(&[], std::slice::from_ref(&a)),
            vec![VolumeEvent::Added(a.clone())]
        );
        assert_eq!(
            diff_volume_snaps(std::slice::from_ref(&a), &[]),
            vec![VolumeEvent::Removed(a.clone())]
        );
        assert_eq!(
            diff_volume_snaps(std::slice::from_ref(&a), std::slice::from_ref(&a_ro)),
            vec![VolumeEvent::Changed {
                from: a.clone(),
                to: a_ro
            }]
        );
        let both = vec![a.clone(), b.clone()];
        assert!(diff_volume_snaps(&both, &both).is_empty());
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
