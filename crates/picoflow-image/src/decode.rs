use std::fs;
use std::io::BufWriter;
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::imageops;
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

/// Rotate already-oriented pixels. `degrees` is 90 (CW), 180, or 270 (CCW).
pub fn rotate_oriented(image: &OrientedImage, degrees: i32) -> Result<OrientedImage, Error> {
    let pixels = match degrees.rem_euclid(360) {
        90 => imageops::rotate90(&image.pixels),
        180 => imageops::rotate180(&image.pixels),
        270 => imageops::rotate270(&image.pixels),
        _ => {
            return Err(Error::unsupported_image(
                "rotation must be 90, 180, or 270 degrees",
            ))
        }
    };
    Ok(OrientedImage {
        pixels,
        source_format: image.source_format,
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

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn rotate_90_cw_swaps_dimensions() {
        let mut pixels = RgbImage::new(3, 1);
        pixels.put_pixel(0, 0, Rgb([1, 0, 0]));
        pixels.put_pixel(2, 0, Rgb([0, 0, 1]));
        let src = OrientedImage {
            pixels,
            source_format: SourceFormat::Png,
        };
        let rotated = rotate_oriented(&src, 90).expect("90 cw");
        assert_eq!(rotated.width(), 1);
        assert_eq!(rotated.height(), 3);
        assert_eq!(rotated.pixels.get_pixel(0, 0).0, [1, 0, 0]);
        assert_eq!(rotated.pixels.get_pixel(0, 2).0, [0, 0, 1]);
        assert!(rotate_oriented(&src, 45).is_err());
    }
}
