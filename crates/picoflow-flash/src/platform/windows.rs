//! Windows: drive letters + `GetVolumeInformationW` labels.

use std::io;
use std::path::PathBuf;

use crate::volume::{path_writable, RawVolume, VolumeSource, LABEL_CIRCUITPY, LABEL_RPI_RP2};

/// Discovers `RPI-RP2` and `CIRCUITPY` as drive-letter roots whose volume label matches.
#[derive(Debug, Clone, Default)]
pub struct WindowsVolumeSource {
    /// Injected `(label, root)` pairs so tests do not need Win32.
    injected: Option<Vec<(String, PathBuf)>>,
}

impl WindowsVolumeSource {
    /// Test helper: treat `roots` as the live drive list.
    pub fn with_labeled_roots(roots: Vec<(String, PathBuf)>) -> Self {
        Self {
            injected: Some(roots),
        }
    }
}

impl VolumeSource for WindowsVolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>> {
        let labeled = match &self.injected {
            Some(roots) => roots.clone(),
            None => live_labeled_roots()?,
        };
        Ok(raw_from_labeled(labeled))
    }
}

pub(crate) fn raw_from_labeled(
    labeled: impl IntoIterator<Item = (String, PathBuf)>,
) -> Vec<RawVolume> {
    let mut out = Vec::new();
    for (label, path) in labeled {
        if label != LABEL_RPI_RP2 && label != LABEL_CIRCUITPY {
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        out.push(RawVolume {
            writable: path_writable(&path),
            label,
            path,
        });
    }
    out.sort_by(|a, b| a.label.cmp(&b.label).then(a.path.cmp(&b.path)));
    out
}

fn live_labeled_roots() -> io::Result<Vec<(String, PathBuf)>> {
    #[cfg(windows)]
    {
        win32_labeled_roots()
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg(windows)]
fn win32_labeled_roots() -> io::Result<Vec<(String, PathBuf)>> {
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const VOLUME_NAME_CHARS: usize = 261;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(lpRootPathName: *const u16) -> u32;
        fn GetVolumeInformationW(
            lpRootPathName: *const u16,
            lpVolumeNameBuffer: *mut u16,
            nVolumeNameSize: u32,
            lpVolumeSerialNumber: *mut u32,
            lpMaximumComponentLength: *mut u32,
            lpFileSystemFlags: *mut u32,
            lpFileSystemNameBuffer: *mut u16,
            nFileSystemNameSize: u32,
        ) -> i32;
    }

    // SAFETY: kernel32 volume APIs; `root` is a NUL-terminated `X:\`.
    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = b'A' + i as u8;
        let root = [u16::from(letter), u16::from(b':'), u16::from(b'\\'), 0];
        let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
        if drive_type != DRIVE_REMOVABLE && drive_type != DRIVE_FIXED {
            continue;
        }
        let mut name = [0u16; VOLUME_NAME_CHARS];
        let ok = unsafe {
            GetVolumeInformationW(
                root.as_ptr(),
                name.as_mut_ptr(),
                name.len() as u32,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0,
            )
        };
        if ok == 0 {
            continue;
        }
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        if len == 0 {
            continue;
        }
        let label = String::from_utf16_lossy(&name[..len]);
        let label = label.trim().to_string();
        if label != LABEL_RPI_RP2 && label != LABEL_CIRCUITPY {
            continue;
        }
        out.push((label, PathBuf::from(format!("{}:\\", char::from(letter)))));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::volume::LABEL_CIRCUITPY;

    #[test]
    fn raw_from_labeled_keeps_exact_pico_names() {
        let tmp = tempfile::tempdir().unwrap();
        let circuitpy = tmp.path().join("E");
        let other = tmp.path().join("F");
        std::fs::create_dir(&circuitpy).unwrap();
        std::fs::create_dir(&other).unwrap();
        let vols = raw_from_labeled([
            (LABEL_CIRCUITPY.to_string(), circuitpy.clone()),
            ("DATA".to_string(), other),
            ("circuitpy".to_string(), tmp.path().join("missing")),
        ]);
        assert_eq!(vols.len(), 1);
        assert_eq!(vols[0].label, LABEL_CIRCUITPY);
        assert_eq!(vols[0].path, circuitpy);
    }
}
