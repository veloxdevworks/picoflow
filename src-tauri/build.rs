fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_pico_volumes",
            "ripple_clip",
            "reorder_clips",
            "insert_wait",
            "pick_import_photos",
            "import_photos",
            "detect_screen_quad",
            "warp_photo",
            "read_photo_bytes",
            "create_project",
            "load_project",
            "save_project",
            "duplicate_project",
            "export_sequence",
            "write_sequence_file",
            "get_firmware_manifest",
        ]),
    ))
    .expect("failed to run tauri-build");
}
