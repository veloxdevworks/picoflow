//! Temp-dir tests for `write_file_bytes`: bytes match, no quarantine, no `._*`.

use std::fs;
use std::path::Path;

use picoflow_flash::{write_file_bytes, VolumeKind};
use tempfile::tempdir;

const PAYLOAD: &[u8] = b"picoflow-byte-copy-fixture\n";

#[test]
fn write_fake_uf2_bytes_match_and_stay_clean() {
    let dir = tempdir().unwrap();
    let dest = dir.path().join("circuitpython.uf2");
    write_file_bytes(&dest, PAYLOAD, VolumeKind::RpiRp2).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), PAYLOAD);
    assert_no_quarantine(&dest);
    assert_no_apple_double(dir.path());
}

#[test]
fn write_fake_code_py_bytes_match_and_stay_clean() {
    let dir = tempdir().unwrap();
    let dest = dir.path().join("code.py");
    write_file_bytes(&dest, PAYLOAD, VolumeKind::Circuitpy).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), PAYLOAD);
    assert_no_quarantine(&dest);
    assert_no_apple_double(dir.path());
}

#[test]
fn circuitpy_write_unlinks_existing_apple_double() {
    let dir = tempdir().unwrap();
    let dest = dir.path().join("code.py");
    let sidecar = dir.path().join("._code.py");
    fs::write(&sidecar, b"appledouble").unwrap();
    write_file_bytes(&dest, PAYLOAD, VolumeKind::Circuitpy).unwrap();
    assert!(!sidecar.exists());
    assert_no_apple_double(dir.path());
}

#[cfg(target_os = "macos")]
#[test]
fn circuitpy_strips_quarantine_rpirp2_skips_strip() {
    let dir = tempdir().unwrap();

    let uf2 = dir.path().join("circuitpython.uf2");
    fs::write(&uf2, b"seed").unwrap();
    set_quarantine(&uf2);
    assert!(has_quarantine(&uf2));
    write_file_bytes(&uf2, PAYLOAD, VolumeKind::RpiRp2).unwrap();
    // Truncate may keep xattrs; skip-strip must not be required to clear them.
    // The dest must still not grow an AppleDouble sidecar.
    assert_eq!(fs::read(&uf2).unwrap(), PAYLOAD);
    assert_no_apple_double(dir.path());

    let code = dir.path().join("code.py");
    fs::write(&code, b"seed").unwrap();
    set_quarantine(&code);
    assert!(has_quarantine(&code));
    write_file_bytes(&code, PAYLOAD, VolumeKind::Circuitpy).unwrap();
    assert!(
        !has_quarantine(&code),
        "CIRCUITPY dest must strip quarantine"
    );
    assert_no_apple_double(dir.path());
}

fn assert_no_apple_double(dir: &Path) {
    for entry in fs::read_dir(dir).unwrap() {
        let name = entry.unwrap().file_name();
        let s = name.to_string_lossy();
        assert!(!s.starts_with("._"), "unexpected AppleDouble sidecar {s}");
    }
}

fn assert_no_quarantine(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        assert!(
            !has_quarantine(path),
            "unexpected com.apple.quarantine on {}",
            path.display()
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
}

#[cfg(target_os = "macos")]
fn has_quarantine(path: &Path) -> bool {
    xattr_len(path, "com.apple.quarantine").is_some()
}

#[cfg(target_os = "macos")]
fn set_quarantine(path: &Path) {
    let c_path = path_c_string(path).expect("path");
    let c_name = std::ffi::CString::new("com.apple.quarantine").unwrap();
    let value = b"0000;picoflow-test";
    // SAFETY: path/name are valid C strings; value points at `value`.
    let rc = unsafe {
        libc::setxattr(
            c_path.as_ptr(),
            c_name.as_ptr(),
            value.as_ptr() as *const libc::c_void,
            value.len(),
            0,
            0,
        )
    };
    assert_eq!(
        rc,
        0,
        "setxattr quarantine: {}",
        std::io::Error::last_os_error()
    );
}

#[cfg(target_os = "macos")]
fn xattr_len(path: &Path, name: &str) -> Option<usize> {
    let c_path = path_c_string(path)?;
    let c_name = std::ffi::CString::new(name).ok()?;
    // SAFETY: valid C strings; size-0 getxattr returns length or -1.
    let n = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            c_name.as_ptr(),
            std::ptr::null_mut(),
            0,
            0,
            0,
        )
    };
    if n < 0 {
        None
    } else {
        Some(n as usize)
    }
}

#[cfg(target_os = "macos")]
fn path_c_string(path: &Path) -> Option<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes()).ok()
}
