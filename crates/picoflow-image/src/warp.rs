use image::{Rgb, RgbImage};
use nalgebra::{Matrix3, SMatrix, SVector, Vector3, SVD};

use crate::{Error, Point};

/// Long edge of the warped PNG is clamped to this many pixels when dest is
/// inferred from the photographed quad. Explicit tablet size is used as-is.
pub const MAX_WARP_LONG_EDGE: u32 = 1920;

/// Destination size from tablet pixels. `0` on either axis falls back to
/// [`dest_size`] of `corners` (legacy / missing target).
pub fn dest_size_for_target(corners: [Point; 4], width: u32, height: u32) -> (u32, u32) {
    if width > 0 && height > 0 {
        (width, height)
    } else {
        dest_size(corners)
    }
}

/// Destination size: mean of opposite sides, long edge clamped to 1920.
pub fn dest_size(corners: [Point; 4]) -> (u32, u32) {
    let [tl, tr, br, bl] = corners;
    let w = (tl.dist(tr) + bl.dist(br)) / 2.0;
    let h = (tl.dist(bl) + tr.dist(br)) / 2.0;
    let w = w.max(1.0);
    let h = h.max(1.0);
    let long = w.max(h);
    let (w, h) = if long > f64::from(MAX_WARP_LONG_EDGE) {
        let s = f64::from(MAX_WARP_LONG_EDGE) / long;
        (w * s, h * s)
    } else {
        (w, h)
    };
    (w.round().max(1.0) as u32, h.round().max(1.0) as u32)
}

/// DLT homography + bilinear sample. `corners` are TL, TR, BR, BL in source pixels.
/// Dest size is inferred from the quad (legacy). Prefer [`warp_quad_to`] when the
/// project has an explicit tablet resolution.
pub fn warp_quad(src: &RgbImage, corners: [Point; 4]) -> Result<RgbImage, Error> {
    warp_quad_to(src, corners, dest_size(corners))
}

/// Warp the confirmed quad into an explicit destination size (tablet pixels).
pub fn warp_quad_to(
    src: &RgbImage,
    corners: [Point; 4],
    dest: (u32, u32),
) -> Result<RgbImage, Error> {
    let (dw, dh) = (dest.0.max(1), dest.1.max(1));
    if dw == 1 && dh == 1 {
        let sx = corners.iter().map(|p| p.x).sum::<f64>() / 4.0;
        let sy = corners.iter().map(|p| p.y).sum::<f64>() / 4.0;
        let mut out = RgbImage::new(1, 1);
        out.put_pixel(0, 0, sample_bilinear(src, sx, sy));
        return Ok(out);
    }

    let dst = [
        Point::new(0.0, 0.0),
        Point::new(f64::from(dw.saturating_sub(1)), 0.0),
        Point::new(
            f64::from(dw.saturating_sub(1)),
            f64::from(dh.saturating_sub(1)),
        ),
        Point::new(0.0, f64::from(dh.saturating_sub(1))),
    ];
    let h = homography(corners, dst).ok_or_else(|| Error::unsupported_image("degenerate quad"))?;
    let h_inv = h
        .try_inverse()
        .ok_or_else(|| Error::unsupported_image("degenerate quad"))?;

    let mut out = RgbImage::new(dw, dh);
    for y in 0..dh {
        for x in 0..dw {
            let p = h_inv * Vector3::new(f64::from(x), f64::from(y), 1.0);
            if p.z.abs() < 1e-12 {
                out.put_pixel(x, y, Rgb([0, 0, 0]));
                continue;
            }
            let sx = p.x / p.z;
            let sy = p.y / p.z;
            out.put_pixel(x, y, sample_bilinear(src, sx, sy));
        }
    }
    Ok(out)
}

/// Direct Linear Transform: 8 equations from 4 point pairs. Maps src → dst.
fn homography(src: [Point; 4], dst: [Point; 4]) -> Option<Matrix3<f64>> {
    let mut a = SMatrix::<f64, 8, 8>::zeros();
    let mut b = SVector::<f64, 8>::zeros();
    for i in 0..4 {
        let (x, y) = (src[i].x, src[i].y);
        let (xp, yp) = (dst[i].x, dst[i].y);
        let r = i * 2;
        a[(r, 0)] = x;
        a[(r, 1)] = y;
        a[(r, 2)] = 1.0;
        a[(r, 6)] = -x * xp;
        a[(r, 7)] = -y * xp;
        b[r] = xp;
        a[(r + 1, 3)] = x;
        a[(r + 1, 4)] = y;
        a[(r + 1, 5)] = 1.0;
        a[(r + 1, 6)] = -x * yp;
        a[(r + 1, 7)] = -y * yp;
        b[r + 1] = yp;
    }

    if let Some(h) = a.lu().solve(&b) {
        return Some(Matrix3::new(
            h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0,
        ));
    }

    // Fallback: null-space of the 8×9 DLT matrix via AᵀA (full 9×9 SVD).
    let mut a9 = SMatrix::<f64, 8, 9>::zeros();
    for i in 0..4 {
        let (x, y) = (src[i].x, src[i].y);
        let (xp, yp) = (dst[i].x, dst[i].y);
        let r = i * 2;
        a9[(r, 0)] = -x;
        a9[(r, 1)] = -y;
        a9[(r, 2)] = -1.0;
        a9[(r, 6)] = xp * x;
        a9[(r, 7)] = xp * y;
        a9[(r, 8)] = xp;
        a9[(r + 1, 3)] = -x;
        a9[(r + 1, 4)] = -y;
        a9[(r + 1, 5)] = -1.0;
        a9[(r + 1, 6)] = yp * x;
        a9[(r + 1, 7)] = yp * y;
        a9[(r + 1, 8)] = yp;
    }
    let ata = a9.transpose() * a9;
    let svd = SVD::new(ata, false, true);
    let v_t = svd.v_t?;
    let last = v_t.nrows().checked_sub(1)?;
    let h = v_t.row(last);
    let m = Matrix3::new(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]);
    if m.iter().all(|v| v.abs() < 1e-12) {
        return None;
    }
    Some(m)
}

fn sample_bilinear(img: &RgbImage, x: f64, y: f64) -> Rgb<u8> {
    let w = img.width();
    let h = img.height();
    if w == 0 || h == 0 {
        return Rgb([0, 0, 0]);
    }
    let x = x.clamp(0.0, f64::from(w - 1));
    let y = y.clamp(0.0, f64::from(h - 1));
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let dx = x - f64::from(x0);
    let dy = y - f64::from(y0);
    let p00 = img.get_pixel(x0, y0).0;
    let p10 = img.get_pixel(x1, y0).0;
    let p01 = img.get_pixel(x0, y1).0;
    let p11 = img.get_pixel(x1, y1).0;
    let mut out = [0u8; 3];
    for c in 0..3 {
        let top = f64::from(p00[c]) * (1.0 - dx) + f64::from(p10[c]) * dx;
        let bot = f64::from(p01[c]) * (1.0 - dx) + f64::from(p11[c]) * dx;
        out[c] = (top * (1.0 - dy) + bot * dy).round() as u8;
    }
    Rgb(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn dest_size_clamps_long_edge() {
        let corners = [
            Point::new(0.0, 0.0),
            Point::new(4000.0, 0.0),
            Point::new(4000.0, 2000.0),
            Point::new(0.0, 2000.0),
        ];
        let (w, h) = dest_size(corners);
        assert_eq!(w.max(h), MAX_WARP_LONG_EDGE);
        assert_eq!(w, 1920);
        assert_eq!(h, 960);
    }

    #[test]
    fn identity_warp_preserves_solid_color() {
        let img = RgbImage::from_pixel(20, 10, Rgb([10, 20, 30]));
        let corners = [
            Point::new(0.0, 0.0),
            Point::new(19.0, 0.0),
            Point::new(19.0, 9.0),
            Point::new(0.0, 9.0),
        ];
        let out = warp_quad(&img, corners).expect("warp");
        assert_eq!(out.get_pixel(0, 0), img.get_pixel(0, 0));
        assert_eq!(
            out.get_pixel(out.width() - 1, out.height() - 1),
            img.get_pixel(19, 9)
        );
    }

    #[test]
    fn dest_size_for_target_uses_tablet_pixels() {
        let corners = [
            Point::new(0.0, 0.0),
            Point::new(4000.0, 0.0),
            Point::new(4000.0, 2000.0),
            Point::new(0.0, 2000.0),
        ];
        assert_eq!(dest_size_for_target(corners, 1280, 800), (1280, 800));
        assert_eq!(dest_size_for_target(corners, 0, 1080), dest_size(corners));
        assert_eq!(dest_size_for_target(corners, 1920, 0), dest_size(corners));
    }

    #[test]
    fn warp_quad_to_honors_target_size() {
        let img = RgbImage::from_pixel(40, 30, Rgb([200, 10, 10]));
        let corners = [
            Point::new(0.0, 0.0),
            Point::new(39.0, 0.0),
            Point::new(39.0, 29.0),
            Point::new(0.0, 29.0),
        ];
        let out = warp_quad_to(&img, corners, (320, 180)).expect("warp");
        assert_eq!(out.dimensions(), (320, 180));
        assert_eq!(out.get_pixel(160, 90), img.get_pixel(20, 15));
    }
}
