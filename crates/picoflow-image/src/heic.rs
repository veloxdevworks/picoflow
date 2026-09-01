use std::path::Path;
use std::process::Command;

use crate::Error;

#[cfg(target_os = "macos")]
const SIPS: &str = "/usr/bin/sips";
const SIPS_FAIL: &str = "HEIC conversion failed (sips).";
#[cfg(not(target_os = "macos"))]
const HEIC_MACOS_ONLY: &str = "HEIC is supported on macOS only in v1";

const HEIC_BRANDS: [&[u8]; 8] = [
    b"heic", b"heif", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"msf1",
];

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
    ensure_decodable_jpeg(bytes)
}

fn ensure_decodable_jpeg(bytes: Vec<u8>) -> Result<Vec<u8>, Error> {
    image::load_from_memory(&bytes).map_err(|_| Error::unsupported_image(SIPS_FAIL))?;
    Ok(bytes)
}

pub fn is_heic_extension(ext: &str) -> bool {
    matches!(ext, "heic" | "heif")
}

pub fn looks_like_heic(bytes: &[u8]) -> bool {
    if bytes.len() < 16 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let box_size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let end = if (16..=bytes.len()).contains(&box_size) {
        box_size
    } else {
        bytes.len()
    };
    if is_heic_brand(&bytes[8..12]) {
        return true;
    }
    let mut offset = 16;
    while offset + 4 <= end {
        if is_heic_brand(&bytes[offset..offset + 4]) {
            return true;
        }
        offset += 4;
    }
    false
}

fn is_heic_brand(brand: &[u8]) -> bool {
    HEIC_BRANDS.contains(&brand)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ftyp(major: &[u8; 4], compatible: &[&[u8; 4]]) -> Vec<u8> {
        let size = 16 + 4 * compatible.len();
        let mut out = Vec::with_capacity(size);
        out.extend_from_slice(&(size as u32).to_be_bytes());
        out.extend_from_slice(b"ftyp");
        out.extend_from_slice(major);
        out.extend_from_slice(&0u32.to_be_bytes());
        for brand in compatible {
            out.extend_from_slice(*brand);
        }
        out
    }

    #[test]
    fn heic_extensions() {
        assert!(is_heic_extension("heic"));
        assert!(is_heic_extension("heif"));
        assert!(!is_heic_extension("jpg"));
    }

    #[test]
    fn heic_brands_include_heix_and_compatible() {
        assert!(looks_like_heic(&ftyp(b"heix", &[b"mif1"])));
        assert!(looks_like_heic(&ftyp(b"mif1", &[b"miaf", b"heic"])));
        assert!(looks_like_heic(&ftyp(b"heic", &[])));
        assert!(!looks_like_heic(&ftyp(b"mif1", &[b"avif"])));
        assert!(!looks_like_heic(&ftyp(b"avif", &[b"mif1"])));
        assert!(!looks_like_heic(b"not a box"));
    }

    #[test]
    fn undecodable_sips_output_uses_sips_message() {
        let err = ensure_decodable_jpeg(b"not a jpeg".to_vec()).unwrap_err();
        match err {
            Error::UnsupportedImage(msg) => assert_eq!(msg, SIPS_FAIL),
            other => panic!("expected unsupported_image, got {other:?}"),
        }
    }
}
