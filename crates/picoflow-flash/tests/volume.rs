//! Injected `/Volumes` tree — no real Pico required.

use std::fs;

use picoflow_flash::platform::{linux::LinuxVolumeSource, windows::WindowsVolumeSource};
use picoflow_flash::{
    list_pico_volumes, list_pico_volumes_with, wait_for_volume_with, DirVolumeSource, HidProfile,
    VolumeKind, VolumeSource, LABEL_CIRCUITPY, LABEL_RPI_RP2,
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
fn linux_scans_media_roots_and_proc_mounts() {
    let root = tempdir().unwrap();
    let media = root.path().join("media").join("alice");
    let run = root.path().join("run").join("media").join("alice");
    fs::create_dir_all(media.join(LABEL_CIRCUITPY)).unwrap();
    fs::create_dir_all(run.join(LABEL_RPI_RP2)).unwrap();
    fs::create_dir_all(media.join("Other")).unwrap();

    let extra = root.path().join("mnt").join(LABEL_CIRCUITPY);
    fs::create_dir_all(&extra).unwrap();
    let proc = root.path().join("mounts");
    fs::write(
        &proc,
        format!(
            "/dev/sdb1 {} vfat rw 0 0\n/dev/sdc1 /media/alice/Other vfat rw 0 0\n",
            extra.display()
        ),
    )
    .unwrap();

    let vols = LinuxVolumeSource::new(vec![media.clone(), run], Some(proc))
        .list_raw()
        .unwrap();
    assert_eq!(vols.len(), 3);
    assert!(vols
        .iter()
        .any(|v| v.label == LABEL_CIRCUITPY && v.path == media.join(LABEL_CIRCUITPY)));
    assert!(vols
        .iter()
        .any(|v| v.label == LABEL_RPI_RP2 && v.path.ends_with(LABEL_RPI_RP2)));
    assert!(vols.iter().any(|v| v.path == extra));
}

#[test]
fn linux_proc_mounts_dedupes_media_root() {
    let root = tempdir().unwrap();
    let media = root.path().join("media").join("alice");
    let circuitpy = media.join(LABEL_CIRCUITPY);
    fs::create_dir_all(&circuitpy).unwrap();
    let proc = root.path().join("mounts");
    fs::write(
        &proc,
        format!("/dev/sdb1 {} vfat rw 0 0\n", circuitpy.display()),
    )
    .unwrap();

    let vols = LinuxVolumeSource::new(vec![media], Some(proc))
        .list_raw()
        .unwrap();
    assert_eq!(vols.len(), 1);
    assert_eq!(vols[0].path, circuitpy);
}

#[test]
fn linux_unreadable_first_root_still_scans_rest() {
    let root = tempdir().unwrap();
    let not_a_dir = root.path().join("not-a-dir");
    fs::write(&not_a_dir, b"x").unwrap();
    let run = root.path().join("run").join("media").join("alice");
    fs::create_dir_all(run.join(LABEL_CIRCUITPY)).unwrap();
    let extra = root.path().join("mnt").join(LABEL_RPI_RP2);
    fs::create_dir_all(&extra).unwrap();
    let proc = root.path().join("mounts");
    fs::write(
        &proc,
        format!("/dev/sdb1 {} vfat rw 0 0\n", extra.display()),
    )
    .unwrap();

    let vols = LinuxVolumeSource::new(vec![not_a_dir, run.clone()], Some(proc))
        .list_raw()
        .unwrap();
    assert_eq!(vols.len(), 2);
    assert!(vols.iter().any(|v| v.path == run.join(LABEL_CIRCUITPY)));
    assert!(vols.iter().any(|v| v.path == extra));
}

#[test]
fn linux_missing_roots_are_empty() {
    let root = tempdir().unwrap();
    let vols = LinuxVolumeSource::new(
        vec![root.path().join("nope")],
        Some(root.path().join("no-proc")),
    )
    .list_raw()
    .unwrap();
    assert!(vols.is_empty());
}

#[test]
fn windows_filters_drive_roots_by_label() {
    let root = tempdir().unwrap();
    let e = root.path().join("E");
    let f = root.path().join("F");
    let g = root.path().join("G");
    fs::create_dir(&e).unwrap();
    fs::create_dir(&f).unwrap();
    fs::create_dir(&g).unwrap();

    let vols = WindowsVolumeSource::with_labeled_roots(vec![
        (LABEL_CIRCUITPY.into(), e.clone()),
        ("DATA".into(), f),
        (LABEL_RPI_RP2.into(), g.clone()),
        ("circuitpy".into(), root.path().join("missing")),
    ])
    .list_raw()
    .unwrap();
    assert_eq!(vols.len(), 2);
    assert_eq!(vols[0].label, LABEL_CIRCUITPY);
    assert_eq!(vols[0].path, e);
    assert_eq!(vols[1].label, LABEL_RPI_RP2);
    assert_eq!(vols[1].path, g);
}

#[cfg(not(windows))]
#[test]
fn windows_live_enum_is_empty_off_windows() {
    assert!(WindowsVolumeSource::default()
        .list_raw()
        .unwrap()
        .is_empty());
}

#[test]
fn platform_list_does_not_panic() {
    let _ = list_pico_volumes();
}

#[test]
fn wait_returns_existing_volume_immediately() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join(LABEL_CIRCUITPY)).unwrap();
    let vol = wait_for_volume_with(
        &DirVolumeSource::new(root.path()),
        VolumeKind::Circuitpy,
        std::time::Duration::from_millis(0),
        |_| {},
    )
    .unwrap();
    assert_eq!(vol.kind, VolumeKind::Circuitpy);
    assert_eq!(vol.label, LABEL_CIRCUITPY);
}

#[test]
fn wait_times_out_when_kind_missing() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join(LABEL_CIRCUITPY)).unwrap();
    let err = wait_for_volume_with(
        &DirVolumeSource::new(root.path()),
        VolumeKind::RpiRp2,
        std::time::Duration::from_millis(0),
        |_| {},
    )
    .unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
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
