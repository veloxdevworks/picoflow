use std::path::{Path, PathBuf};

use picoflow_core::HidProfile;
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::error::AppError;

/// Same path as `tauri.conf.json` `bundle.resources` so `resolve` maps `../` → `_up_`.
const FIRMWARE_RESOURCE: &str = "../assets/firmware";
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareManifest {
    pub schema_version: u32,
    pub circuitpython: CircuitpythonManifest,
    pub runtime: RuntimeManifest,
    pub hid_profiles: HidProfiles,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircuitpythonManifest {
    pub version: String,
    pub board: String,
    pub language: String,
    pub uf2: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub version: String,
    pub entry: RuntimeEntry,
    pub lib: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEntry {
    pub code: String,
    pub default_sequence: String,
    pub identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HidProfiles {
    pub absolute_mouse_keyboard: HidProfileFiles,
    pub digitizer_keyboard: HidProfileFiles,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HidProfileFiles {
    pub boot: String,
}

impl HidProfiles {
    #[allow(dead_code)]
    pub fn boot_for(&self, profile: HidProfile) -> &str {
        match profile {
            HidProfile::AbsoluteMouseKeyboard => &self.absolute_mouse_keyboard.boot,
            HidProfile::DigitizerKeyboard => &self.digitizer_keyboard.boot,
            _ => &self.absolute_mouse_keyboard.boot,
        }
    }
}

pub fn firmware_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .resolve(FIRMWARE_RESOURCE, BaseDirectory::Resource)
        .map_err(|err| AppError::io(format!("failed to resolve firmware resource dir: {err}")))
}

pub fn load_firmware_manifest(app: &AppHandle) -> Result<FirmwareManifest, AppError> {
    load_manifest_from_dir(&firmware_dir(app)?)
}

pub fn load_manifest_from_dir(dir: &Path) -> Result<FirmwareManifest, AppError> {
    let path = dir.join(MANIFEST_FILE);
    if !path.is_file() {
        return Err(AppError::not_found(format!(
            "firmware manifest not found at {} (bundle assets/firmware; HID spike vendors the UF2)",
            path.display()
        )));
    }
    let text = std::fs::read_to_string(&path)?;
    let mut manifest: FirmwareManifest = serde_json::from_str(&text).map_err(|err| {
        AppError::io(format!(
            "invalid firmware manifest {}: {err}",
            path.display()
        ))
    })?;
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(AppError::io(format!(
            "unsupported firmware manifest schemaVersion {} (expected {MANIFEST_SCHEMA_VERSION})",
            manifest.schema_version
        )));
    }
    resolve_manifest_paths(dir, &mut manifest);
    Ok(manifest)
}

fn resolve_manifest_paths(dir: &Path, manifest: &mut FirmwareManifest) {
    manifest.circuitpython.uf2 = resolve_resource(dir, &manifest.circuitpython.uf2);
    manifest.runtime.entry.code = resolve_resource(dir, &manifest.runtime.entry.code);
    manifest.runtime.entry.default_sequence =
        resolve_resource(dir, &manifest.runtime.entry.default_sequence);
    manifest.runtime.entry.identity = resolve_resource(dir, &manifest.runtime.entry.identity);
    for lib in &mut manifest.runtime.lib {
        *lib = resolve_resource(dir, lib);
    }
    manifest.hid_profiles.absolute_mouse_keyboard.boot =
        resolve_resource(dir, &manifest.hid_profiles.absolute_mouse_keyboard.boot);
    manifest.hid_profiles.digitizer_keyboard.boot =
        resolve_resource(dir, &manifest.hid_profiles.digitizer_keyboard.boot);
}

fn resolve_resource(dir: &Path, relative: &str) -> String {
    let base = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let path = base.join(relative);
    path.canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest_json() -> String {
        serde_json::json!({
            "schemaVersion": 1,
            "circuitpython": {
                "version": "10.2.1",
                "board": "raspberry_pi_pico",
                "language": "en_US",
                "uf2": "circuitpython/pico.uf2",
                "sha256": "abc"
            },
            "runtime": {
                "version": "0.1.0",
                "entry": {
                    "code": "runtime/code.py",
                    "defaultSequence": "runtime/sequence.default.json",
                    "identity": "runtime/picoflow.json"
                },
                "lib": ["runtime/lib/adafruit_hid", "runtime/lib/picoflow"]
            },
            "hidProfiles": {
                "absolute_mouse_keyboard": { "boot": "runtime/boot_abs_mouse.py" },
                "digitizer_keyboard": { "boot": "runtime/boot_digitizer.py" }
            }
        })
        .to_string()
    }

    fn temp_firmware_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "picoflow-fw-manifest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_manifest_is_not_found() {
        let dir = temp_firmware_dir();
        let err = load_manifest_from_dir(&dir).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::NotFound);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolves_relative_paths_against_resource_dir() {
        let dir = temp_firmware_dir();
        std::fs::write(dir.join(MANIFEST_FILE), sample_manifest_json()).unwrap();
        let manifest = load_manifest_from_dir(&dir).expect("parse sample manifest");
        let prefix = dir.canonicalize().unwrap();
        assert!(Path::new(&manifest.circuitpython.uf2).starts_with(&prefix));
        assert!(
            manifest
                .circuitpython
                .uf2
                .ends_with("circuitpython/pico.uf2")
                || Path::new(&manifest.circuitpython.uf2).ends_with("pico.uf2")
        );
        assert!(Path::new(&manifest.runtime.entry.code).starts_with(&prefix));
        assert!(
            Path::new(&manifest.hid_profiles.absolute_mouse_keyboard.boot).starts_with(&prefix)
        );
        assert_eq!(manifest.runtime.lib.len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }
}
