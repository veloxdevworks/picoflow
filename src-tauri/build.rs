fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_pico_volumes",
            "ripple_clip",
            "reorder_clips",
            "insert_wait",
        ]),
    ))
    .expect("failed to run tauri-build");
}
