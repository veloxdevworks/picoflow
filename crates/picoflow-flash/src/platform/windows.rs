//! Windows volume discovery is P1 (PR 16).

use std::io;

use crate::volume::{RawVolume, VolumeSource};

/// Stub: FLASH-1 on Windows is P1.
#[derive(Debug, Clone, Copy, Default)]
pub struct WindowsVolumeSource;

impl VolumeSource for WindowsVolumeSource {
    fn list_raw(&self) -> io::Result<Vec<RawVolume>> {
        Ok(Vec::new())
    }
}
