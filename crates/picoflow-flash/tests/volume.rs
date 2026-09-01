//! Injected `/Volumes` tree — no real Pico required.

use std::fs;

use picoflow_flash::platform::{linux::LinuxVolumeSource, windows::WindowsVolumeSource};
use picoflow_flash::{
    list_pico_volumes, list_pico_volumes_with, DirVolumeSource, HidProfile, VolumeKind,
    VolumeSource, LABEL_CIRCUITPY, LABEL_RPI_RP2,
};
use tempfile::tempdir;

#[test]
fn lists_rpi_rp2_and_circuitpy_from_fake_volumes() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join(LABEL_RPI_RP2)).unwrap();
    fs::create_dir(root.path().join(LABEL_CIRCUITPY)).unwrap();
    fs::create_dir(root.path().join("Macintosh HD")).unwrap();

    let vols = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert_eq!(vols.len(), 2);
    assert_eq!(vols[0].kind, VolumeKind::Circuitpy);
    assert_eq!(vols[0].label, LABEL_CIRCUITPY);
    assert_eq!(vols[0].path, root.path().join(LABEL_CIRCUITPY));
    assert_eq!(vols[0].id, vols[0].path.to_string_lossy());
    assert!(vols[0].writable);
    assert_eq!(vols[0].picoflow, None);

    assert_eq!(vols[1].kind, VolumeKind::RpiRp2);
    assert_eq!(vols[1].label, LABEL_RPI_RP2);
    assert_eq!(vols[1].picoflow, None);
}

#[test]
fn lowercase_labels_do_not_match() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("rpi-rp2")).unwrap();
    fs::create_dir(root.path().join("circuitpy")).unwrap();
    let vols = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert!(vols.is_empty());
}

#[test]
fn circuitpy_reads_picoflow_json_rpirp2_does_not() {
    let root = tempdir().unwrap();
    let circuitpy = root.path().join(LABEL_CIRCUITPY);
    let rpi = root.path().join(LABEL_RPI_RP2);
    fs::create_dir(&circuitpy).unwrap();
    fs::create_dir(&rpi).unwrap();
    fs::write(
        circuitpy.join("picoflow.json"),
        r#"{"runtime_version":"0.1.0","hid_profile":"absolute_mouse_keyboard"}"#,
    )
    .unwrap();
    fs::write(
        rpi.join("picoflow.json"),
        r#"{"runtime_version":"9.9.9","hid_profile":"digitizer_keyboard"}"#,
    )
    .unwrap();

    let vols = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    let cp = vols
        .iter()
        .find(|v| v.kind == VolumeKind::Circuitpy)
        .unwrap();
    let identity = cp.picoflow.as_ref().expect("picoflow identity");
    assert_eq!(identity.runtime_version, "0.1.0");
    assert_eq!(identity.hid_profile, HidProfile::AbsoluteMouseKeyboard);

    let rp = vols.iter().find(|v| v.kind == VolumeKind::RpiRp2).unwrap();
    assert_eq!(rp.picoflow, None);
}

#[test]
fn picoflow_cache_evicts_when_volume_dir_disappears() {
    let root = tempdir().unwrap();
    let circuitpy = root.path().join(LABEL_CIRCUITPY);
    fs::create_dir(&circuitpy).unwrap();
    let json = circuitpy.join("picoflow.json");
    let identity_a = r#"{"runtime_version":"0.1.0","hid_profile":"absolute_mouse_keyboard"}"#;
    fs::write(&json, identity_a).unwrap();
    let mtime = fs::metadata(&json).unwrap().modified().unwrap();

    let first = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert_eq!(first[0].picoflow.as_ref().unwrap().runtime_version, "0.1.0");

    fs::remove_dir_all(&circuitpy).unwrap();
    let gone = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert!(gone.is_empty());

    fs::create_dir(&circuitpy).unwrap();
    // Same length as identity_a so mtime+len would hit a stale cache if not evicted.
    fs::write(
        &json,
        r#"{"runtime_version":"0.2.0","hid_profile":"absolute_mouse_keyboard"}"#,
    )
    .unwrap();
    fs::File::open(&json).unwrap().set_modified(mtime).unwrap();

    let second = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert_eq!(
        second[0].picoflow.as_ref().unwrap().runtime_version,
        "0.2.0"
    );
}

#[test]
fn invalid_picoflow_json_is_null_volume_still_listed() {
    let root = tempdir().unwrap();
    let circuitpy = root.path().join(LABEL_CIRCUITPY);
    fs::create_dir(&circuitpy).unwrap();
    fs::write(circuitpy.join("picoflow.json"), "{nope").unwrap();

    let vols = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert_eq!(vols.len(), 1);
    assert_eq!(vols[0].kind, VolumeKind::Circuitpy);
    assert_eq!(vols[0].picoflow, None);
}

#[test]
fn missing_volumes_root_is_empty() {
    let root = tempdir().unwrap();
    let missing = root.path().join("nope");
    let vols = list_pico_volumes_with(&DirVolumeSource::new(missing)).unwrap();
    assert!(vols.is_empty());
}

#[test]
fn windows_and_linux_stubs_return_empty() {
    assert!(WindowsVolumeSource.list_raw().unwrap().is_empty());
    assert!(LinuxVolumeSource.list_raw().unwrap().is_empty());
}

#[test]
fn platform_list_does_not_panic() {
    let _ = list_pico_volumes();
}

#[cfg(unix)]
#[test]
fn read_only_circuitpy_is_not_writable() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempdir().unwrap();
    let vol = root.path().join(LABEL_CIRCUITPY);
    fs::create_dir(&vol).unwrap();
    let mut perms = fs::metadata(&vol).unwrap().permissions();
    perms.set_mode(0o555);
    fs::set_permissions(&vol, perms).unwrap();

    let vols = list_pico_volumes_with(&DirVolumeSource::new(root.path())).unwrap();
    assert_eq!(vols.len(), 1);
    assert!(!vols[0].writable);

    let mut perms = fs::metadata(&vol).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&vol, perms).unwrap();
}
