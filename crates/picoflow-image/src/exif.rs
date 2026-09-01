use std::io::Cursor;

use exif::{In, Reader, Tag};
use image::imageops;
use image::RgbImage;

/// Read EXIF `Orientation` (1–8). Missing or unreadable EXIF is `None`.
pub fn read_orientation(bytes: &[u8]) -> Option<u32> {
    let mut cursor = Cursor::new(bytes);
    let exif = Reader::new().read_from_container(&mut cursor).ok()?;
    let field = exif.get_field(Tag::Orientation, In::PRIMARY)?;
    field.value.get_uint(0)
}

/// Apply EXIF orientation so returned pixels match on-screen display.
pub fn apply_orientation(img: RgbImage, orientation: u32) -> RgbImage {
    match orientation {
        2 => imageops::flip_horizontal(&img),
        3 => imageops::rotate180(&img),
        4 => imageops::flip_vertical(&img),
        // Transpose: 0th row = visual left, 0th column = visual top.
        5 => imageops::rotate90(&imageops::flip_vertical(&img)),
        6 => imageops::rotate90(&img),
        // Transverse: 0th row = visual right, 0th column = visual bottom.
        7 => imageops::rotate90(&imageops::flip_horizontal(&img)),
        8 => imageops::rotate270(&img),
        _ => img,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    fn rgb(w: u32, h: u32, color: [u8; 3]) -> RgbImage {
        RgbImage::from_pixel(w, h, Rgb(color))
    }

    #[test]
    fn orientation_6_swaps_width_and_height() {
        let mut img = rgb(40, 80, [20, 80, 180]);
        for x in 0..40 {
            img.put_pixel(x, 0, Rgb([220, 30, 30]));
        }
        let oriented = apply_orientation(img.clone(), 6);
        assert_eq!(oriented.dimensions(), (80, 40));
        // rotate90 CW: stored (x, 0) → (h-1, x) = right column.
        for y in 0..40 {
            assert_eq!(oriented.get_pixel(79, y), &Rgb([220, 30, 30]));
        }
        // rotate270 would put that row on the left, not the right.
        let ccw = apply_orientation(img, 8);
        assert_eq!(ccw.dimensions(), (80, 40));
        for y in 0..40 {
            assert_ne!(ccw.get_pixel(79, y), &Rgb([220, 30, 30]));
            assert_eq!(ccw.get_pixel(0, y), &Rgb([220, 30, 30]));
        }
    }

    #[test]
    fn orientation_1_is_identity() {
        let img = rgb(12, 8, [1, 2, 3]);
        let oriented = apply_orientation(img.clone(), 1);
        assert_eq!(oriented.dimensions(), img.dimensions());
    }
}
