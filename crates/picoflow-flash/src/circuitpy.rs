//! Per-file CIRCUITPY writer (Phase B).
//!
//! Never copy a tree, never emit `settings.toml`. AppleDouble `._*` is unlinked
//! before write; `code.py` is last so a mid-copy unplug leaves a bootable volume
//! without a half-written entrypoint.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::copy::write_file_bytes;
use crate::volume::{PicoflowIdentity, VolumeKind};

const IDENTITY_NAME: &str = "picoflow.json";
const SEQUENCE_NAME: &str = "sequence.json";
const BOOT_NAME: &str = "boot.py";
const CODE_NAME: &str = "code.py";
const METADATA_NEVER_INDEX: &str = ".metadata_never_index";
const FSEVENTSD: &str = ".fseventsd";
const NO_LOG: &str = "no_log";

/// Source bytes / lib dirs for a full Phase B install.
pub struct CircuitpyPayload {
    /// Resolved package directories (`…/lib/adafruit_hid`, `…/lib/picoflow`).
    pub lib_dirs: Vec<PathBuf>,
    pub identity_json: Vec<u8>,
    pub sequence_json: Vec<u8>,
    pub boot_py: Vec<u8>,
    pub code_py: Vec<u8>,
}

/// Write runtime + sequence onto an existing CIRCUITPY root.
///
/// Order: `lib/**/*.py` → `picoflow.json` → `sequence.json` → `boot.py` →
/// quiet-volume markers (if missing) → `code.py` last.
pub fn write_circuitpy(volume_root: &Path, payload: &CircuitpyPayload) -> io::Result<Vec<PathBuf>> {
    require_existing_volume(volume_root)?;
    unlink_apple_doubles(volume_root);

    let mut written = Vec::new();
    for (rel, bytes) in collect_lib_py_files(&payload.lib_dirs)? {
        write_rel(volume_root, &rel, &bytes, &mut written)?;
    }
    write_rel(
        volume_root,
        Path::new(IDENTITY_NAME),
        &payload.identity_json,
        &mut written,
    )?;
    write_rel(
        volume_root,
        Path::new(SEQUENCE_NAME),
        &payload.sequence_json,
        &mut written,
    )?;
    write_rel(
        volume_root,
        Path::new(BOOT_NAME),
        &payload.boot_py,
        &mut written,
    )?;
    ensure_finder_quiet(volume_root, &mut written)?;
    write_rel(
        volume_root,
        Path::new(CODE_NAME),
        &payload.code_py,
        &mut written,
    )?;
    unlink_apple_doubles(volume_root);
    Ok(written)
}

/// Write only `sequence.json`. Caller has already gated version/profile.
pub fn write_sequence_only(volume_root: &Path, sequence_json: &[u8]) -> io::Result<PathBuf> {
    require_existing_volume(volume_root)?;
    unlink_apple_doubles(volume_root);
    let dest = volume_root.join(SEQUENCE_NAME);
    write_file_bytes(&dest, sequence_json, VolumeKind::Circuitpy)?;
    unlink_apple_doubles(volume_root);
    Ok(dest)
}

/// Fresh parse of `picoflow.json` (no poll cache).
pub fn read_identity(volume_root: &Path) -> Option<PicoflowIdentity> {
    let bytes = fs::read(volume_root.join(IDENTITY_NAME)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn require_existing_volume(volume_root: &Path) -> io::Result<()> {
    if volume_root.is_dir() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "CIRCUITPY volume {} is missing. Press RESET on the Pico and retry. If the volume is missing, re-enter BOOTSEL.",
                volume_root.display()
            ),
        ))
    }
}

fn write_rel(
    volume_root: &Path,
    rel: &Path,
    bytes: &[u8],
    written: &mut Vec<PathBuf>,
) -> io::Result<()> {
    let dest = volume_root.join(rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    write_file_bytes(&dest, bytes, VolumeKind::Circuitpy)?;
    written.push(dest);
    Ok(())
}

fn ensure_finder_quiet(volume_root: &Path, written: &mut Vec<PathBuf>) -> io::Result<()> {
    let meta = volume_root.join(METADATA_NEVER_INDEX);
    if !meta.exists() {
        write_file_bytes(&meta, b"", VolumeKind::Circuitpy)?;
        written.push(meta);
    }
    let fse = volume_root.join(FSEVENTSD);
    if !fse.is_dir() {
        fs::create_dir_all(&fse)?;
    }
    let no_log = fse.join(NO_LOG);
    if !no_log.exists() {
        write_file_bytes(&no_log, b"", VolumeKind::Circuitpy)?;
        written.push(no_log);
    }
    Ok(())
}

fn collect_lib_py_files(lib_dirs: &[PathBuf]) -> io::Result<Vec<(PathBuf, Vec<u8>)>> {
    let mut files = Vec::new();
    for lib_dir in lib_dirs {
        let name = lib_dir.file_name().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("lib dir {} has no name", lib_dir.display()),
            )
        })?;
        let dest_root = Path::new("lib").join(name);
        collect_py_tree(lib_dir, lib_dir, &dest_root, &mut files)?;
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}

fn collect_py_tree(
    src_root: &Path,
    dir: &Path,
    dest_root: &Path,
    out: &mut Vec<(PathBuf, Vec<u8>)>,
) -> io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<io::Result<Vec<_>>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if name_str.starts_with("._")
            || name_str == ".DS_Store"
            || name_str == "__pycache__"
            || name_str == "settings.toml"
        {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_py_tree(src_root, &path, dest_root, out)?;
            continue;
        }
        if !name_str.ends_with(".py") {
            continue;
        }
        let rel = path.strip_prefix(src_root).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{} is not under {}", path.display(), src_root.display()),
            )
        })?;
        out.push((dest_root.join(rel), fs::read(&path)?));
    }
    Ok(())
}

fn unlink_apple_doubles(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with("._") {
            let _ = fs::remove_file(&path);
            continue;
        }
        if path.is_dir() {
            unlink_apple_doubles(&path);
        }
    }
}
