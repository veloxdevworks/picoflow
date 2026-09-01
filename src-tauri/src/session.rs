use std::path::PathBuf;

/// Session-scoped path sandbox used by later commands.
///
/// Commands must only touch `project_dir`, paths from the last native dialog,
/// and volumes from the last scan.
#[derive(Debug, Clone, Default)]
pub struct Session {
    pub project_dir: Option<PathBuf>,
    pub last_dialog_paths: Vec<PathBuf>,
    #[allow(dead_code)]
    pub last_volumes: Vec<LastVolume>,
}

/// Volume identity remembered from the last `list_pico_volumes` scan.
#[derive(Debug, Clone)]
pub struct LastVolume {
    pub id: String,
    pub path: PathBuf,
}
