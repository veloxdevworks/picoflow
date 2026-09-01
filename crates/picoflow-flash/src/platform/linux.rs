//! Linux volume discovery is P1 (PR 16).

use std::io;

use crate::volume::{RawVolume, VolumeSource};

/// Stub: FLASH-1 on Linux is P1.
#[derive(Debug, Clone, Copy, Default)]
pub struct LinuxVolumeSource;

impl VolumeSource for LinuxVolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>> {
        Ok(Vec::new())
    }
}
