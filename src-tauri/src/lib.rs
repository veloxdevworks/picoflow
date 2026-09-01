mod commands;
mod error;
mod resources;
mod session;

pub use error::{AppError, ErrorCode};
pub use session::{LastVolume, Session};

use std::sync::Mutex;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_tracing(app)?;
            app.manage(Mutex::new(Session::default()));
            tracing::info!("picoflow starting");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::flash::list_pico_volumes,
            commands::timeline::ripple_clip,
            commands::timeline::reorder_clips,
            commands::timeline::insert_wait,
            commands::image::pick_import_photos,
            commands::image::import_photos,
            commands::image::detect_screen_quad,
            commands::image::warp_photo,
            commands::image::read_photo_bytes,
            commands::project::create_project,
            commands::project::load_project,
            commands::project::save_project,
            commands::project::duplicate_project,
            commands::project::export_sequence,
            commands::project::write_sequence_file,
            commands::firmware::get_firmware_manifest,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_tracing(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let log_dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&log_dir)?;

    let file_appender = tracing_appender::rolling::daily(&log_dir, "picoflow.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    // WorkerGuard must outlive the process so file logs flush.
    app.manage(FileLogGuard { _guard: guard });

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking);

    #[cfg(debug_assertions)]
    {
        tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
            .init();
    }

    #[cfg(not(debug_assertions))]
    {
        tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .init();
    }

    Ok(())
}

struct FileLogGuard {
    _guard: tracing_appender::non_blocking::WorkerGuard,
}
