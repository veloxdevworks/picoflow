use std::path::Path;
use std::process::Command;

use crate::Error;

#[cfg(target_os = "macos")]
const SIPS: &str = "/usr/bin/sips";
#[cfg(target_os = "macos")]
const SIPS_FAIL: &str = "HEIC conversion failed (sips).";
#[cfg(not(target_os = "macos"))]
const HEIC_MACOS_ONLY: &str = "HEIC is supported on macOS only in v1";

/// Convert HEIC/HEIF to JPEG bytes. Fail closed with `unsupported_image`.
pub fn convert_heic_to_jpeg(path: &Path) -> Result<Vec<u8>, Error> {
    #[cfg(target_os = "macos")]
    {
        convert_macos(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err(Error::unsupported_image(HEIC_MACOS_ONLY))
    }
}

#[cfg(target_os = "macos")]
fn convert_macos(path: &Path) -> Result<Vec<u8>, Error> {
    let tmp = tempfile::Builder::new()
        .prefix("picoflow-heic-")
        .suffix(".jpg")
        .tempfile()?;
    let tmp_path = tmp.path();

    let output = Command::new(SIPS)
        .args(["-s", "format", "jpeg", "-o"])
        .arg(tmp_path)
        .arg(path)
        .output();

    let output = match output {
        Ok(output) => output,
        Err(_) => return Err(Error::unsupported_image(SIPS_FAIL)),
    };
    if !output.status.success() {
        return Err(Error::unsupported_image(SIPS_FAIL));
    }

    let bytes = std::fs::read(tmp_path).map_err(|_| Error::unsupported_image(SIPS_FAIL))?;
    if bytes.len() < 3 || bytes[0] != 0xFF || bytes[1] != 0xD8 || bytes[2] != 0xFF {
        return Err(Error::unsupported_image(SIPS_FAIL));
    }
    Ok(bytes)
}

pub fn is_heic_extension(ext: &str) -> bool {
    matches!(ext, "heic" | "heif")
}

pub fn looks_like_heic(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let brand = &bytes[8..12];
    brand == b"heic"
        || brand == b"heif"
        || brand == b"mif1"
        || brand == b"msf1"
        || brand == b"heim"
        || brand == b"heis"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heic_extensions() {
        assert!(is_heic_extension("heic"));
        assert!(is_heic_extension("heif"));
        assert!(!is_heic_extension("jpg"));
    }
}
