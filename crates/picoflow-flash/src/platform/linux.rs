//! Linux: `/media/$USER`, `/run/media/$USER`, then `/proc/mounts`.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::PathBuf;

use crate::volume::{
    path_writable, scan_volume_root, RawVolume, VolumeSource, LABEL_CIRCUITPY, LABEL_RPI_RP2,
};

/// Discovers `RPI-RP2` and `CIRCUITPY` under the usual udisks mount roots.
#[derive(Debug, Clone)]
pub struct LinuxVolumeSource {
    roots: Vec<PathBuf>,
    proc_mounts: Option<PathBuf>,
}

impl LinuxVolumeSource {
    pub fn new(roots: Vec<PathBuf>, proc_mounts: Option<PathBuf>) -> Self {
        Self { roots, proc_mounts }
    }
}

impl Default for LinuxVolumeSource {
    fn default() -> Self {
        Self {
            roots: default_media_roots(),
            proc_mounts: Some(PathBuf::from("/proc/mounts")),
        }
    }
}

fn default_media_roots() -> Vec<PathBuf> {
    let user = current_username();
    vec![
        PathBuf::from("/media").join(&user),
        PathBuf::from("/run/media").join(&user),
    ]
}

fn current_username() -> OsString {
    std::env::var_os("USER")
        .or_else(|| std::env::var_os("LOGNAME"))
        .or_else(|| std::env::var_os("USERNAME"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| OsString::from("user"))
}

impl VolumeSource for LinuxVolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for root in &self.roots {
            match scan_volume_root(root) {
                Ok(volumes) => {
                    for volume in volumes {
                        if seen.insert(volume.path.clone()) {
                            out.push(volume);
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!(
                        error = %e,
                        path = %root.display(),
                        "skipping unreadable volume root"
                    );
                }
            }
        }
        if let Some(proc) = &self.proc_mounts {
            match fs::read_to_string(proc) {
                Ok(text) => {
                    for (label, path) in parse_proc_mounts(&text) {
                        if !path.is_dir() || !seen.insert(path.clone()) {
                            continue;
                        }
                        out.push(RawVolume {
                            writable: path_writable(&path),
                            label,
                            path,
                        });
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => {
                    tracing::debug!(error = %e, "skipping unreadable /proc/mounts");
                }
            }
        }
        out.sort_by(|a, b| a.label.cmp(&b.label).then(a.path.cmp(&b.path)));
        Ok(out)
    }
}

/// Mount points whose last component is `RPI-RP2` or `CIRCUITPY`.
pub(crate) fn parse_proc_mounts(text: &str) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(mount) = mount_point_from_line(line) else {
            continue;
        };
        let Some(label) = mount.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if label != LABEL_RPI_RP2 && label != LABEL_CIRCUITPY {
            continue;
        }
        out.push((label.to_string(), mount));
    }
    out
}

fn mount_point_from_line(line: &str) -> Option<PathBuf> {
    let mut fields = line.split(' ');
    let _device = fields.next()?;
    let mount = fields.next()?;
    Some(PathBuf::from(unescape_mount(mount)))
}

fn unescape_mount(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 3 < bytes.len() {
            let oct = &raw[i + 1..i + 4];
            if oct.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
                if let Ok(v) = u8::from_str_radix(oct, 8) {
                    out.push(char::from(v));
                    i += 4;
                    continue;
                }
            }
        }
        out.push(char::from(bytes[i]));
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parse_proc_mounts_keeps_exact_pico_labels() {
        let text = "\
/dev/sdb1 /run/media/alice/CIRCUITPY vfat rw,nosuid 0 0
/dev/sdc1 /media/alice/RPI-RP2 vfat rw 0 0
/dev/sdd1 /media/alice/Other vfat rw 0 0
/dev/sde1 /media/alice/circuitpy vfat rw 0 0
";
        let found = parse_proc_mounts(text);
        assert_eq!(
            found,
            vec![
                (
                    LABEL_CIRCUITPY.to_string(),
                    PathBuf::from("/run/media/alice/CIRCUITPY")
                ),
                (
                    LABEL_RPI_RP2.to_string(),
                    PathBuf::from("/media/alice/RPI-RP2")
                ),
            ]
        );
    }

    #[test]
    fn parse_proc_mounts_unescapes_octal_in_parent() {
        let text = "/dev/sdb1 /run/media/alice\\040x/CIRCUITPY vfat rw 0 0\n";
        let found = parse_proc_mounts(text);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, Path::new("/run/media/alice x/CIRCUITPY"));
    }
}
