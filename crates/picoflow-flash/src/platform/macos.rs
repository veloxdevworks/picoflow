//! macOS: labels under `/Volumes`.

use std::io;
use std::path::PathBuf;

use crate::volume::{scan_volume_root, RawVolume, VolumeSource};

const VOLUMES: &str = "/Volumes";

/// Discovers `RPI-RP2` and `CIRCUITPY` as `/Volumes/<label>`.
#[derive(Debug, Clone)]
pub struct MacOsVolumeSource {
    root: PathBuf,
}

impl Default for MacOsVolumeSource {
    fn default() -> Self {
        Self {
            root: PathBuf::from(VOLUMES),
        }
    }
}

impl VolumeSource for MacOsVolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>> {
        scan_volume_root(&self.root)
    }
}
