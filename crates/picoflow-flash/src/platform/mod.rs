//! OS-specific mount discovery (macOS `/Volumes`, Windows letters, Linux media).

pub mod linux;
pub mod macos;
pub mod windows;

use crate::volume::VolumeSource;

pub fn default_source() -> impl VolumeSource {
    #[cfg(target_os = "macos")]
    {
        macos::MacOsVolumeSource::default()
    }
    #[cfg(target_os = "windows")]
    {
        windows::WindowsVolumeSource::default()
    }
    #[cfg(target_os = "linux")]
    {
        linux::LinuxVolumeSource::default()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        EmptyVolumeSource
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
struct EmptyVolumeSource;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
impl VolumeSource for EmptyVolumeSource {
    fn list_raw(&self) -> std::io::Result<Vec<crate::volume::RawVolume>> {
        Ok(Vec::new())
    }
}
