//! Temp-dir CIRCUITPY writer: expected file set, no `settings.toml`, no `._*`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use picoflow_flash::{
    read_identity, write_circuitpy, write_sequence_only, CircuitpyPayload, HidProfile,
};
use tempfile::tempdir;

fn write_src(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

fn seed_runtime(root: &Path) -> (PathBuf, PathBuf) {
    let adafruit = root.join("lib/adafruit_hid");
    let picoflow = root.join("lib/picoflow");
    write_src(&adafruit.join("__init__.py"), "HID = 1\n");
    write_src(&adafruit.join("mouse.py"), "class Mouse: pass\n");
    write_src(
        &picoflow.join("__init__.py"),
        "from .playback import Player\n",
    );
    write_src(&picoflow.join("playback.py"), "class Player: pass\n");
    write_src(&picoflow.join("._skip_me.py"), "should not be copied\n");
    write_src(&root.join("lib/.DS_Store"), "host junk\n");
    write_src(&root.join("settings.toml"), "CIRCUITPY_USB_HID=0\n");
    (adafruit, picoflow)
}

fn payload(root: &Path, hid_profile: &str, boot: &str) -> CircuitpyPayload {
    let (adafruit, picoflow) = seed_runtime(root);
    CircuitpyPayload {
        lib_dirs: vec![adafruit, picoflow],
        identity_json: format!(
            "{{\n  \"runtime_version\": \"0.1.0\",\n  \"hid_profile\": \"{hid_profile}\"\n}}\n"
        )
        .into_bytes(),
        sequence_json: b"{\"version\":1,\"run_mode\":\"auto\",\"events\":[]}\n".to_vec(),
        boot_py: boot.as_bytes().to_vec(),
        code_py: b"print('code')\n".to_vec(),
    }
}

fn collect_rel_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    collect_rel_files_inner(root, root, &mut out);
    out.sort();
    out
}

fn collect_rel_files_inner(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let mut entries: Vec<_> = fs::read_dir(dir).unwrap().map(|e| e.unwrap()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap();
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            collect_rel_files_inner(root, &path, out);
        } else {
            out.push(rel_s);
        }
    }
}

fn assert_no_apple_double(root: &Path) {
    for name in collect_rel_files(root) {
        let base = Path::new(&name).file_name().unwrap().to_string_lossy();
        assert!(
            !base.starts_with("._"),
            "unexpected AppleDouble sidecar {name}"
        );
    }
}

fn file_mtime(path: &Path) -> SystemTime {
    fs::metadata(path).unwrap().modified().unwrap()
}

#[test]
fn write_circuitpy_expected_file_set_no_settings_no_appledouble() {
    let src = tempdir().unwrap();
    let dest = tempdir().unwrap();
    fs::write(dest.path().join("._code.py"), b"finder junk").unwrap();
    fs::create_dir_all(dest.path().join("lib/picoflow")).unwrap();
    fs::write(dest.path().join("lib/picoflow/._playback.py"), b"junk").unwrap();

    let payload = payload(src.path(), "absolute_mouse_keyboard", "# abs mouse boot\n");
    let written = write_circuitpy(dest.path(), &payload).unwrap();
    assert_eq!(
        written.last().unwrap().file_name().unwrap(),
        "code.py",
        "code.py must be written last"
    );

    let files = collect_rel_files(dest.path());
    let expected = [
        ".fseventsd/no_log",
        ".metadata_never_index",
        "boot.py",
        "code.py",
        "lib/adafruit_hid/__init__.py",
        "lib/adafruit_hid/mouse.py",
        "lib/picoflow/__init__.py",
        "lib/picoflow/playback.py",
        "picoflow.json",
        "sequence.json",
    ];
    assert_eq!(files, expected);
    assert!(!files.iter().any(|f| f.contains("settings.toml")));
    assert!(!dest.path().join("settings.toml").exists());
    assert_no_apple_double(dest.path());

    assert_eq!(
        fs::read_to_string(dest.path().join("boot.py")).unwrap(),
        "# abs mouse boot\n"
    );
    assert_eq!(
        fs::read_to_string(dest.path().join("code.py")).unwrap(),
        "print('code')\n"
    );
    let identity = read_identity(dest.path()).expect("picoflow.json");
    assert_eq!(identity.runtime_version, "0.1.0");
    assert_eq!(identity.hid_profile, HidProfile::AbsoluteMouseKeyboard);
}

#[test]
fn write_circuitpy_code_py_mtime_is_last() {
    let src = tempdir().unwrap();
    let dest = tempdir().unwrap();
    let payload = payload(src.path(), "digitizer_keyboard", "# digitizer boot\n");
    write_circuitpy(dest.path(), &payload).unwrap();

    let code_mtime = file_mtime(&dest.path().join("code.py"));
    for name in collect_rel_files(dest.path()) {
        if name == "code.py" {
            continue;
        }
        let mtime = file_mtime(&dest.path().join(&name));
        assert!(mtime <= code_mtime, "{name} mtime is after code.py");
    }
    assert_eq!(
        fs::read_to_string(dest.path().join("boot.py")).unwrap(),
        "# digitizer boot\n"
    );
}

#[test]
fn write_sequence_only_does_not_touch_boot_or_code() {
    let src = tempdir().unwrap();
    let dest = tempdir().unwrap();
    let payload = payload(src.path(), "absolute_mouse_keyboard", "# boot keep\n");
    write_circuitpy(dest.path(), &payload).unwrap();

    let boot = dest.path().join("boot.py");
    let code = dest.path().join("code.py");
    let boot_bytes = fs::read(&boot).unwrap();
    let code_bytes = fs::read(&code).unwrap();
    let boot_mtime = file_mtime(&boot);
    let code_mtime = file_mtime(&code);

    fs::write(dest.path().join("._sequence.json"), b"junk").unwrap();
    write_sequence_only(dest.path(), b"{\"version\":1,\"events\":[]}\n").unwrap();

    assert_eq!(fs::read(&boot).unwrap(), boot_bytes);
    assert_eq!(fs::read(&code).unwrap(), code_bytes);
    assert_eq!(file_mtime(&boot), boot_mtime);
    assert_eq!(file_mtime(&code), code_mtime);
    assert_eq!(
        fs::read(dest.path().join("sequence.json")).unwrap(),
        b"{\"version\":1,\"events\":[]}\n"
    );
    assert!(!dest.path().join("settings.toml").exists());
    assert_no_apple_double(dest.path());
}

#[test]
fn missing_volume_is_not_created() {
    let src = tempdir().unwrap();
    let dest = tempdir().unwrap();
    let missing = dest.path().join("CIRCUITPY");
    let payload = payload(src.path(), "absolute_mouse_keyboard", "# boot\n");
    let err = write_circuitpy(&missing, &payload).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    assert!(!missing.exists(), "must not mkdir a vanished CIRCUITPY");
}
