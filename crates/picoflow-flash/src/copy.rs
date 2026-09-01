//! Byte-copy primitive for UF2 and CIRCUITPY.
//!
//! Never `std::fs::copy` and never copyfile(3): those emit xattrs / AppleDouble
//! that the RP2040 bootloader and CIRCUITPY volume cannot tolerate.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

use crate::volume::VolumeKind;

/// POSIX create/truncate/write/fsync/close of `bytes` to `dest`.
///
/// After every byte has been handed to the kernel, dest vanished is **success**
/// for [`VolumeKind::RpiRp2`] (`EIO`/`ENOENT`, even if a stale `exists` check
/// still sees the path) — the RP2040 UF2 bootloader unmounts `RPI-RP2` as soon
/// as the image is accepted. CIRCUITPY / generic dests only treat a gone path
/// as success; `EIO` while the dest still exists is propagated.
///
/// Skip xattr strip when `kind` is [`VolumeKind::RpiRp2`]. CIRCUITPY / generic
/// dests get a best-effort strip (`ENOATTR` ignored).
pub fn write_file_bytes(dest: &Path, bytes: &[u8], kind: VolumeKind) -> io::Result<()> {
    unlink_apple_double_best_effort(dest);

    let result = posix_write(dest, bytes, kind);

    if result.is_ok() && kind != VolumeKind::RpiRp2 && dest.exists() {
        strip_xattrs_best_effort(dest);
    }

    result
}

fn posix_write(dest: &Path, bytes: &[u8], kind: VolumeKind) -> io::Result<()> {
    let mut opts = OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o644);
    }

    let mut file = opts.open(dest)?;

    let (written, write_res) = write_all_counted(&mut file, bytes);
    if let Err(e) = write_res {
        let exists = dest.exists();
        drop(file);
        return classify_write_outcome(Err(e), written, bytes.len(), exists, kind);
    }

    match file.sync_all() {
        Ok(()) => {}
        Err(e) => {
            let exists = dest.exists();
            drop(file);
            return classify_write_outcome(Err(e), written, bytes.len(), exists, kind);
        }
    }

    match close_file(file) {
        Ok(()) => Ok(()),
        Err(e) => classify_write_outcome(Err(e), written, bytes.len(), dest.exists(), kind),
    }
}

fn write_all_counted(file: &mut File, bytes: &[u8]) -> (usize, io::Result<()>) {
    let mut written = 0;
    while written < bytes.len() {
        match file.write(&bytes[written..]) {
            Ok(0) => {
                return (
                    written,
                    Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "failed to write whole buffer",
                    )),
                );
            }
            Ok(n) => written += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return (written, Err(e)),
        }
    }
    (written, Ok(()))
}

/// Full-byte write then dest gone is always success. `EIO`/`ENOENT` while the
/// path still exists is success only for [`VolumeKind::RpiRp2`].
fn classify_write_outcome(
    op: io::Result<()>,
    written: usize,
    total: usize,
    dest_exists: bool,
    kind: VolumeKind,
) -> io::Result<()> {
    match op {
        Ok(()) => Ok(()),
        Err(err) => {
            if written < total {
                return Err(err);
            }
            if !dest_exists {
                return Ok(());
            }
            if kind == VolumeKind::RpiRp2 && is_vanished_io(&err) {
                return Ok(());
            }
            Err(err)
        }
    }
}

fn is_vanished_io(err: &io::Error) -> bool {
    if err.kind() == io::ErrorKind::NotFound {
        return true;
    }
    match err.raw_os_error() {
        #[cfg(unix)]
        Some(code) if code == libc::ENOENT || code == libc::EIO => true,
        _ => false,
    }
}

#[cfg(unix)]
fn close_file(file: File) -> io::Result<()> {
    use std::os::unix::io::IntoRawFd;
    let fd = file.into_raw_fd();
    // SAFETY: `fd` is exclusively owned after `into_raw_fd`; close once.
    let rc = unsafe { libc::close(fd) };
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn close_file(file: File) -> io::Result<()> {
    drop(file);
    Ok(())
}

fn unlink_apple_double_best_effort(dest: &Path) {
    let Some(name) = dest.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    let sidecar = dest.with_file_name(format!("._{name}"));
    let _ = fs::remove_file(sidecar);
}

fn strip_xattrs_best_effort(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        macos_strip_xattrs(path);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
}

#[cfg(target_os = "macos")]
fn macos_strip_xattrs(path: &Path) {
    let Some(c_path) = path_c_string(path) else {
        return;
    };

    // SAFETY: `c_path` is a valid C string for the dest path; size-0 listxattr
    // queries the buffer length.
    let needed = unsafe { libc::listxattr(c_path.as_ptr(), std::ptr::null_mut(), 0, 0) };
    if needed <= 0 {
        return;
    }

    let mut buf = vec![0u8; needed as usize];
    // SAFETY: `buf` is sized from the previous listxattr result.
    let n = unsafe {
        libc::listxattr(
            c_path.as_ptr(),
            buf.as_mut_ptr() as *mut libc::c_char,
            buf.len(),
            0,
        )
    };
    if n <= 0 {
        return;
    }
    buf.truncate(n as usize);

    for name in buf.split(|b| *b == 0).filter(|s| !s.is_empty()) {
        let Ok(c_name) = std::ffi::CString::new(name) else {
            continue;
        };
        // SAFETY: both pointers are valid C strings; ENOATTR is ignored.
        let rc = unsafe { libc::removexattr(c_path.as_ptr(), c_name.as_ptr(), 0) };
        if rc != 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ENOATTR) {
                tracing::debug!(
                    path = %path.display(),
                    error = %err,
                    "xattr strip failed"
                );
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn path_c_string(path: &Path) -> Option<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dest_vanished_enoent_after_full_write_is_success() {
        let err = io::Error::from_raw_os_error(libc::ENOENT);
        classify_write_outcome(Err(err), 16, 16, false, VolumeKind::RpiRp2)
            .expect("ENOENT after full write");
    }

    #[test]
    fn rpirp2_eio_after_full_write_is_success_even_if_dest_exists() {
        let err = io::Error::from_raw_os_error(libc::EIO);
        classify_write_outcome(Err(err), 16, 16, true, VolumeKind::RpiRp2)
            .expect("RpiRp2 EIO after full write");
    }

    #[test]
    fn circuitpy_eio_after_full_write_with_dest_is_error() {
        let err = io::Error::from_raw_os_error(libc::EIO);
        let out = classify_write_outcome(Err(err), 16, 16, true, VolumeKind::Circuitpy);
        assert!(out.is_err(), "CIRCUITPY EIO with dest present must fail");
    }

    #[test]
    fn circuitpy_full_write_dest_gone_is_ok() {
        let err = io::Error::from_raw_os_error(libc::EIO);
        classify_write_outcome(Err(err), 16, 16, false, VolumeKind::Circuitpy)
            .expect("CIRCUITPY dest gone is success");
    }

    #[test]
    fn partial_write_then_vanish_is_error() {
        let err = io::Error::from_raw_os_error(libc::EIO);
        let out = classify_write_outcome(Err(err), 4, 16, false, VolumeKind::RpiRp2);
        assert!(out.is_err(), "partial write must not count as success");
    }

    #[test]
    fn full_write_other_error_with_dest_is_error() {
        let err = io::Error::new(io::ErrorKind::PermissionDenied, "nope");
        assert!(classify_write_outcome(Err(err), 16, 16, true, VolumeKind::Circuitpy).is_err());
    }

    #[test]
    fn full_write_other_error_dest_gone_is_ok() {
        let err = io::Error::new(io::ErrorKind::PermissionDenied, "nope");
        classify_write_outcome(Err(err), 16, 16, false, VolumeKind::Circuitpy)
            .expect("gone dest is success");
    }
}
