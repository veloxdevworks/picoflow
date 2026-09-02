use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

/// Native File menu (New / Open / Save / Duplicate / Export) plus Edit/Window chrome.
pub fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let file_new = MenuItemBuilder::with_id("file-new", "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_open = MenuItemBuilder::with_id("file-open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_save = MenuItemBuilder::with_id("file-save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let file_dup = MenuItemBuilder::with_id("file-duplicate", "Duplicate…").build(app)?;
    let file_export = MenuItemBuilder::with_id("file-export", "Export Sequence…").build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_new)
        .item(&file_open)
        .separator()
        .item(&file_save)
        .item(&file_dup)
        .separator()
        .item(&file_export)
        .build()?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "PicoFlow")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        let edit_menu = SubmenuBuilder::new(app, "Edit")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;
        let window_menu = SubmenuBuilder::new(app, "Window")
            .minimize()
            .maximize()
            .separator()
            .close_window()
            .build()?;
        app.set_menu(
            MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?,
        )?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let edit_menu = SubmenuBuilder::new(app, "Edit")
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;
        app.set_menu(
            MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .build()?,
        )?;
    }

    app.on_menu_event(|app, event| {
        let payload = match event.id().as_ref() {
            "file-new" => "new",
            "file-open" => "open",
            "file-save" => "save",
            "file-duplicate" => "duplicate",
            "file-export" => "export",
            _ => return,
        };
        let _ = app.emit("picoflow-menu", payload);
    });

    Ok(())
}
