use std::fs;
use std::io::BufWriter;
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::{load_from_memory, RgbImage};

use crate::exif::{apply_orientation, read_orientation};
use crate::heic::{convert_heic_to_jpeg, is_heic_extension, looks_like_heic};
use crate::{map_image_err, Error};

pub const JPEG_QUALITY: u8 = 90;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    Jpeg,
    Png,
    Heic,
}

impl SourceFormat {
    pub fn raw_extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg | Self::Heic => "jpg",
        }
    }
}

/// Pixels already rotated/flipped to match display orientation.
#[derive(Clone, Debug)]
pub struct OrientedImage {
    pub pixels: RgbImage,
    pub source_format: SourceFormat,
}

impl OrientedImage {
    pub fn width(&self) -> u32 {
        self.pixels.width()
    }

    pub fn height(&self) -> u32 {
        self.pixels.height()
    }

    pub fn dimensions(&self) -> (u32, u32) {
        self.pixels.dimensions()
    }
}

/// Decode JPEG/PNG, or HEIC (macOS via sips), and apply EXIF orientation.
pub fn decode_path(path: &Path) -> Result<OrientedImage, Error> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if is_heic_extension(&ext) {
        let jpeg = convert_heic_to_jpeg(path)?;
        return decode_bytes(&jpeg, SourceFormat::Heic);
    }

    let bytes = fs::read(path)?;
    if looks_like_heic(&bytes) {
        let jpeg = convert_heic_to_jpeg(path)?;
        return decode_bytes(&jpeg, SourceFormat::Heic);
    }

    let format = match ext.as_str() {
        "png" => SourceFormat::Png,
        "jpg" | "jpeg" => SourceFormat::Jpeg,
        _ => sniff_format(&bytes)?,
    };
    decode_bytes(&bytes, format)
}

fn sniff_format(bytes: &[u8]) -> Result<SourceFormat, Error> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        Ok(SourceFormat::Jpeg)
    } else if bytes.len() >= 8
        && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
    {
        Ok(SourceFormat::Png)
    } else {
        Err(Error::unsupported_image("unsupported image format"))
    }
}

fn decode_bytes(bytes: &[u8], source_format: SourceFormat) -> Result<OrientedImage, Error> {
    let orientation = read_orientation(bytes).unwrap_or(1);
    let img = load_from_memory(bytes).map_err(map_image_err)?;
    let pixels = apply_orientation(img.to_rgb8(), orientation);
    Ok(OrientedImage {
        pixels,
        source_format,
    })
}

/// Persist already-oriented pixels: JPEG q90, or PNG if the source was PNG.
pub fn save_oriented(image: &OrientedImage, dest: &Path) -> Result<(), Error> {
    match image.source_format {
        SourceFormat::Png => image.pixels.save(dest).map_err(map_image_err),
        SourceFormat::Jpeg | SourceFormat::Heic => save_jpeg(&image.pixels, dest),
    }
}

fn save_jpeg(pixels: &RgbImage, dest: &Path) -> Result<(), Error> {
    let file = fs::File::create(dest)?;
    let mut encoder = JpegEncoder::new_with_quality(BufWriter::new(file), JPEG_QUALITY);
    encoder.encode_image(pixels).map_err(map_image_err)
}
