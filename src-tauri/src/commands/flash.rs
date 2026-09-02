use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use picoflow_core::{ensure_version, Sequence, SEQUENCE_SCHEMA_VERSION};
use picoflow_flash::{
    sha256_matches, write_file_bytes, CircuitpyPayload, HidProfile as FlashHidProfile, PicoVolume,
    PicoflowIdentity, VolumeKind,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::resources::{load_firmware_manifest, FirmwareManifest};
use crate::session::{LastVolume, Session};

fn lock_session(session: &Mutex<Session>) -> std::sync::MutexGuard<'_, Session> {
    session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn record_volumes(session: &mut Session, volumes: &[PicoVolume]) {
    session.last_volumes = volumes
        .iter()
        .map(|v| LastVolume {
            id: v.id.clone(),
            path: v.path.clone(),
            kind: v.kind,
            writable: v.writable,
        })
        .collect();
}

fn require_scanned_volume(
    session: &Session,
    volume_id: &str,
    kind: VolumeKind,
) -> Result<LastVolume, AppError> {
    let volume = session.require_volume(volume_id)?.clone();
    if volume.kind != kind {
        return Err(AppError::path_not_allowed(format!(
            "volume {volume_id} is {:?}, expected {kind:?}",
            volume.kind
        )));
    }
    if !volume.writable {
        return Err(AppError::volume_not_writable(format!(
            "volume {} is not writable",
            volume.path.display()
        )));
    }
    Ok(volume)
}

fn to_flash_profile(profile: picoflow_core::HidProfile) -> Result<FlashHidProfile, AppError> {
    match profile {
        picoflow_core::HidProfile::AbsoluteMouseKeyboard => {
            Ok(FlashHidProfile::AbsoluteMouseKeyboard)
        }
        picoflow_core::HidProfile::DigitizerKeyboard => Ok(FlashHidProfile::DigitizerKeyboard),
        other => Err(AppError::hid_mismatch(format!(
            "hid_profile {other:?} is not in the firmware manifest"
        ))),
    }
}

fn json_bytes(value: &impl Serialize) -> Result<Vec<u8>, AppError> {
    let mut json = serde_json::to_string_pretty(value)
        .map_err(|err| AppError::io(format!("serialize json: {err}")))?;
    json.push('\n');
    Ok(json.into_bytes())
}

fn sequence_bytes(sequence: &Sequence) -> Result<Vec<u8>, AppError> {
    ensure_version(sequence.version, SEQUENCE_SCHEMA_VERSION)?;
    sequence.validate_events()?;
    json_bytes(sequence)
}

fn identity_bytes(
    runtime_version: &str,
    hid_profile: FlashHidProfile,
) -> Result<Vec<u8>, AppError> {
    json_bytes(&serde_json::json!({
        "runtime_version": runtime_version,
        "hid_profile": hid_profile,
    }))
}

fn circuitpy_payload(
    manifest: &FirmwareManifest,
    sequence: &Sequence,
) -> Result<CircuitpyPayload, AppError> {
    let profile = to_flash_profile(sequence.hid_profile)?;
    let boot_path = manifest
        .hid_profiles
        .boot_for(sequence.hid_profile)
        .ok_or_else(|| {
            AppError::hid_mismatch(format!(
                "hid_profile {:?} is not in the firmware manifest",
                sequence.hid_profile
            ))
        })?;
    Ok(CircuitpyPayload {
        lib_dirs: manifest.runtime.lib.iter().map(PathBuf::from).collect(),
        identity_json: identity_bytes(&manifest.runtime.version, profile)?,
        sequence_json: sequence_bytes(sequence)?,
        boot_py: std::fs::read(boot_path)?,
        code_py: std::fs::read(&manifest.runtime.entry.code)?,
    })
}

fn sequence_only_allowed(
    identity: Option<&PicoflowIdentity>,
    runtime_version: &str,
    hid_profile: FlashHidProfile,
) -> Result<(), AppError> {
    let Some(identity) = identity else {
        return Err(AppError::not_picoflow(
            "picoflow.json missing or invalid; use full install",
        ));
    };
    if identity.runtime_version != runtime_version || identity.hid_profile != hid_profile {
        return Err(AppError::not_picoflow(
            "runtime_version or hid_profile does not match; use full install",
        ));
    }
    Ok(())
}

fn map_circuitpy_io(err: io::Error) -> AppError {
    let hint = "Press RESET on the Pico and retry. If the volume is missing, re-enter BOOTSEL.";
    let message = format!("{err}. {hint}");
    let app = match err.kind() {
        io::ErrorKind::NotFound => AppError::not_found(message),
        _ => AppError::io(message),
    };
    tracing::error!(code = ?app.code, message = %app.message, "circuitpy io");
    app
}

async fn run_blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|err| Err(AppError::io(format!("background task failed: {err}"))))
}

fn record_volumes_on_app(app: &AppHandle, volumes: &[PicoVolume]) {
    let session = app.state::<Mutex<Session>>();
    let mut session = lock_session(&session);
    record_volumes(&mut session, volumes);
}

fn eject_path(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        match Command::new("diskutil").arg("eject").arg(path).output() {
            Ok(out) if out.status.success() => {}
            Ok(out) => {
                tracing::warn!(
                    path = %path.display(),
                    status = ?out.status,
                    stderr = %String::from_utf8_lossy(&out.stderr),
                    "diskutil eject failed"
                );
            }
            Err(err) => {
                tracing::warn!(path = %path.display(), error = %err, "diskutil eject failed");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        tracing::warn!(
            path = %path.display(),
            "eject_volume is a warning no-op off macOS"
        );
    }
}

/// List mounted `RPI-RP2` / `CIRCUITPY` volumes and remember them for later path checks.
#[tauri::command]
pub fn list_pico_volumes(session: State<'_, Mutex<Session>>) -> Result<Vec<PicoVolume>, AppError> {
    let volumes = picoflow_flash::list_pico_volumes()?;
    let mut session = lock_session(&session);
    record_volumes(&mut session, &volumes);
    Ok(volumes)
}

/// Byte-copy the bundled UF2 onto an `RpiRp2` volume. Does not wait for CIRCUITPY.
#[tauri::command]
pub async fn flash_uf2(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    volume_id: String,
) -> Result<(), AppError> {
    let volume = {
        let session = lock_session(&session);
        require_scanned_volume(&session, &volume_id, VolumeKind::RpiRp2)?
    };
    let manifest = load_firmware_manifest(&app)?;
    let uf2_path = PathBuf::from(&manifest.circuitpython.uf2);
    let expected_sha = manifest.circuitpython.sha256.clone();
    let dest = volume.path.join("circuitpython.uf2");
    run_blocking(move || {
        let bytes = std::fs::read(&uf2_path)?;
        if !sha256_matches(&bytes, &expected_sha) {
            return Err(AppError::uf2_checksum(format!(
                "bundled UF2 sha256 mismatch (expected {expected_sha})"
            )));
        }
        write_file_bytes(&dest, &bytes, VolumeKind::RpiRp2).map_err(map_circuitpy_io)
    })
    .await
}

/// Poll `list_pico_volumes` until `kind` appears or `timeout_ms` elapses.
#[tauri::command]
pub async fn wait_for_volume(
    app: AppHandle,
    kind: VolumeKind,
    timeout_ms: u64,
) -> Result<PicoVolume, AppError> {
    let timeout = Duration::from_millis(timeout_ms);
    run_blocking(move || {
        match picoflow_flash::wait_for_volume_with(
            &picoflow_flash::platform::default_source(),
            kind,
            timeout,
            |vols| record_volumes_on_app(&app, vols),
        ) {
            Ok(volume) => Ok(volume),
            Err(err) if err.kind() == io::ErrorKind::TimedOut => {
                Err(AppError::flash_timeout(err.to_string()))
            }
            Err(err) => Err(err.into()),
        }
    })
    .await
}

/// Full Phase B: lib → identity (from sequence + manifest) → sequence → boot → code.py last.
#[tauri::command]
pub async fn write_circuitpy(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    volume_id: String,
    sequence: Sequence,
) -> Result<(), AppError> {
    let volume = {
        let session = lock_session(&session);
        require_scanned_volume(&session, &volume_id, VolumeKind::Circuitpy)?
    };
    let manifest = load_firmware_manifest(&app)?;
    let payload = circuitpy_payload(&manifest, &sequence)?;
    let path = volume.path;
    run_blocking(move || {
        picoflow_flash::write_circuitpy(&path, &payload).map_err(map_circuitpy_io)?;
        Ok(())
    })
    .await
}

/// Rewrite `sequence.json` only when on-device identity matches bundled runtime + sequence profile.
#[tauri::command]
pub async fn write_sequence_only(
    app: AppHandle,
    session: State<'_, Mutex<Session>>,
    volume_id: String,
    sequence: Sequence,
) -> Result<(), AppError> {
    let volume = {
        let session = lock_session(&session);
        require_scanned_volume(&session, &volume_id, VolumeKind::Circuitpy)?
    };
    let manifest = load_firmware_manifest(&app)?;
    let profile = to_flash_profile(sequence.hid_profile)?;
    let runtime_version = manifest.runtime.version.clone();
    let path = volume.path;
    let bytes = sequence_bytes(&sequence)?;
    run_blocking(move || {
        let identity = picoflow_flash::read_identity(&path);
        sequence_only_allowed(identity.as_ref(), &runtime_version, profile)?;
        picoflow_flash::write_sequence_only(&path, &bytes).map_err(map_circuitpy_io)?;
        Ok(())
    })
    .await
}

/// macOS `diskutil eject <path>` as an argv array. Failure is a warning, not a hard error.
#[tauri::command]
pub fn eject_volume(session: State<'_, Mutex<Session>>, volume_id: String) -> Result<(), AppError> {
    let volume = {
        let session = lock_session(&session);
        session.require_volume(&volume_id)?.clone()
    };
    eject_path(&volume.path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use picoflow_core::HidProfile;

    fn sample_sequence(profile: HidProfile) -> Sequence {
        Sequence {
            version: SEQUENCE_SCHEMA_VERSION,
            run_mode: picoflow_core::RunMode::Auto,
            settle_ms: 1200,
            hid_profile: profile,
            button_pin: "GP15".into(),
            events: Vec::new(),
        }
    }

    #[test]
    fn require_scanned_volume_rejects_unknown_and_wrong_kind() {
        let mut session = Session::default();
        session.last_volumes.push(LastVolume {
            id: "/Volumes/RPI-RP2".into(),
            path: PathBuf::from("/Volumes/RPI-RP2"),
            kind: VolumeKind::RpiRp2,
            writable: true,
        });
        let err = require_scanned_volume(&session, "/Volumes/CIRCUITPY", VolumeKind::Circuitpy)
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);

        let err = require_scanned_volume(&session, "/Volumes/RPI-RP2", VolumeKind::Circuitpy)
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::PathNotAllowed);

        require_scanned_volume(&session, "/Volumes/RPI-RP2", VolumeKind::RpiRp2).unwrap();
    }

    #[test]
    fn require_scanned_volume_rejects_read_only() {
        let mut session = Session::default();
        session.last_volumes.push(LastVolume {
            id: "/Volumes/CIRCUITPY".into(),
            path: PathBuf::from("/Volumes/CIRCUITPY"),
            kind: VolumeKind::Circuitpy,
            writable: false,
        });
        let err = require_scanned_volume(&session, "/Volumes/CIRCUITPY", VolumeKind::Circuitpy)
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::VolumeNotWritable);
    }

    #[test]
    fn sequence_only_requires_exact_runtime_and_profile() {
        let identity = PicoflowIdentity {
            runtime_version: "0.1.0".into(),
            hid_profile: FlashHidProfile::AbsoluteMouseKeyboard,
        };
        sequence_only_allowed(
            Some(&identity),
            "0.1.0",
            FlashHidProfile::AbsoluteMouseKeyboard,
        )
        .unwrap();

        let err = sequence_only_allowed(None, "0.1.0", FlashHidProfile::AbsoluteMouseKeyboard)
            .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::NotPicoflow);

        let err = sequence_only_allowed(
            Some(&identity),
            "0.2.0",
            FlashHidProfile::AbsoluteMouseKeyboard,
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::NotPicoflow);

        let err =
            sequence_only_allowed(Some(&identity), "0.1.0", FlashHidProfile::DigitizerKeyboard)
                .unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::NotPicoflow);
    }

    #[test]
    fn identity_json_is_snake_case_from_sequence_profile() {
        let bytes = identity_bytes("0.1.0", FlashHidProfile::DigitizerKeyboard).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["runtime_version"], "0.1.0");
        assert_eq!(value["hid_profile"], "digitizer_keyboard");
        assert!(value.get("runtimeVersion").is_none());
    }

    #[test]
    fn sequence_bytes_round_trip_profile() {
        let seq = sample_sequence(HidProfile::DigitizerKeyboard);
        let bytes = sequence_bytes(&seq).unwrap();
        let parsed = picoflow_core::parse_sequence(std::str::from_utf8(&bytes).unwrap()).unwrap();
        assert_eq!(parsed.hid_profile, HidProfile::DigitizerKeyboard);
    }

    #[test]
    fn sha256_mismatch_is_detected() {
        assert!(!sha256_matches(b"not-a-uf2", "deadbeef"));
        assert!(sha256_matches(
            b"abc",
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        ));
    }
}
