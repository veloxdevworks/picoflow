use std::fs;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::{GenericImageView, Rgb, RgbImage};
use imageproc::drawing::draw_filled_rect_mut;
use imageproc::rect::Rect;
use picoflow_image::{
    decode_path, dest_size, dest_size_for_target, detect_screen_quad, save_oriented, warp_quad,
    warp_quad_to, Error, OrientedImage, Point, SourceFormat, DETECT_CONFIDENCE_THRESHOLD,
    MAX_WARP_LONG_EDGE,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn encode_jpeg(img: &RgbImage, quality: u8) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder.encode_image(img).expect("encode jpeg");
    buf
}

/// APP1 Exif with a single IFD0 Orientation SHORT.
fn jpeg_with_orientation(img: &RgbImage, orientation: u16) -> Vec<u8> {
    let jpeg = encode_jpeg(img, 90);
    assert_eq!(&jpeg[0..2], &[0xFF, 0xD8]);
    let mut payload = Vec::new();
    payload.extend_from_slice(b"Exif\0\0");
    payload.extend_from_slice(&[0x49, 0x49, 0x2A, 0x00]); // TIFF LE
    payload.extend_from_slice(&[0x08, 0x00, 0x00, 0x00]); // IFD0 offset
    payload.extend_from_slice(&[0x01, 0x00]); // 1 entry
    payload.extend_from_slice(&[0x12, 0x01]); // tag Orientation
    payload.extend_from_slice(&[0x03, 0x00]); // SHORT
    payload.extend_from_slice(&[0x01, 0x00, 0x00, 0x00]); // count
    payload.extend_from_slice(&orientation.to_le_bytes());
    payload.extend_from_slice(&[0x00, 0x00]); // value padding
    payload.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // next IFD
    let len = u16::try_from(payload.len() + 2).expect("app1 fits");
    let mut out = Vec::with_capacity(jpeg.len() + payload.len() + 4);
    out.extend_from_slice(&[0xFF, 0xD8, 0xFF, 0xE1]);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&payload);
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn write_orientation6_fixture() -> PathBuf {
    let dir = fixtures_dir();
    fs::create_dir_all(&dir).expect("fixtures dir");
    let path = dir.join("orientation6.jpg");
    // Stored portrait 40×80; Orientation=6 displays as 80×40.
    let mut img = RgbImage::from_pixel(40, 80, Rgb([20, 80, 180]));
    for x in 0..40 {
        img.put_pixel(x, 0, Rgb([220, 30, 30]));
    }
    fs::write(&path, jpeg_with_orientation(&img, 6)).expect("write orientation6.jpg");
    path
}

fn synthetic_rectangle() -> (RgbImage, [Point; 4]) {
    let mut img = RgbImage::from_pixel(800, 600, Rgb([18, 18, 22]));
    let rect = Rect::at(120, 80).of_size(560, 440);
    draw_filled_rect_mut(&mut img, rect, Rgb([236, 240, 244]));
    let corners = [
        Point::new(120.0, 80.0),
        Point::new(679.0, 80.0),
        Point::new(679.0, 519.0),
        Point::new(120.0, 519.0),
    ];
    (img, corners)
}

fn glossy_noisy_quad() -> RgbImage {
    let mut img = RgbImage::new(640, 480);
    for y in 0..480u32 {
        for x in 0..640u32 {
            let n = ((x.wrapping_mul(73) ^ y.wrapping_mul(41)) % 40) as u8;
            img.put_pixel(x, y, Rgb([24 + n / 2, 26 + n / 3, 30 + n / 2]));
        }
    }
    // Perspective-ish bright "screen" with a glare hotspot.
    for y in 70..410u32 {
        for x in 90..560u32 {
            let px = x as i32;
            let py = y as i32;
            // Slightly skewed right edge.
            let right = 540 + (py - 70) / 12;
            let left = 100 - (py - 70) / 20;
            if px < left || px > right {
                continue;
            }
            let glare = {
                let dx = px as f64 - 420.0;
                let dy = py as f64 - 140.0;
                (-(dx * dx + dy * dy) / 2800.0).exp()
            };
            let base = 190.0 + glare * 60.0;
            let noise = ((px.wrapping_mul(19) ^ py.wrapping_mul(7)) % 28) as f64;
            let v = (base + noise - 10.0).clamp(0.0, 255.0) as u8;
            img.put_pixel(x, y, Rgb([v, v.saturating_sub(4), v.saturating_sub(8)]));
        }
    }
    img
}

fn max_corner_error(got: &[Point; 4], expected: &[Point; 4]) -> f64 {
    got.iter()
        .zip(expected.iter())
        .map(|(a, b)| a.dist(*b))
        .fold(0.0, f64::max)
}

#[test]
fn synthetic_rectangle_detects_with_high_confidence() {
    let (img, expected) = synthetic_rectangle();
    let result = detect_screen_quad(&img);
    assert!(
        result.confidence >= 0.7,
        "confidence {} < 0.7, corners {:?}",
        result.confidence,
        result.corners
    );
    assert_eq!(result.image_width, 800);
    assert_eq!(result.image_height, 600);
    let err = max_corner_error(&result.corners, &expected);
    assert!(
        err <= 5.0,
        "corners {:?} off by {err} px from {:?}",
        result.corners,
        expected
    );
}

/// Long-edge 1600 forces the detect downscale path (DETECT_LONG_EDGE is 1280).
#[test]
fn large_synthetic_rectangle_still_detects() {
    let mut img = RgbImage::from_pixel(1600, 1200, Rgb([18, 18, 22]));
    let rect = Rect::at(240, 160).of_size(1120, 880);
    draw_filled_rect_mut(&mut img, rect, Rgb([236, 240, 244]));
    let expected = [
        Point::new(240.0, 160.0),
        Point::new(1359.0, 160.0),
        Point::new(1359.0, 1039.0),
        Point::new(240.0, 1039.0),
    ];
    let result = detect_screen_quad(&img);
    assert!(
        result.confidence >= 0.7,
        "confidence {} < 0.7 after downscale, corners {:?}",
        result.confidence,
        result.corners
    );
    let err = max_corner_error(&result.corners, &expected);
    assert!(
        err <= 8.0,
        "downscaled corners {:?} off by {err} px from {:?}",
        result.corners,
        expected
    );
}

fn assert_red_right_column(img: &RgbImage) {
    assert_eq!(img.dimensions(), (80, 40));
    for y in 0..40 {
        let p = img.get_pixel(79, y).0;
        assert!(
            p[0] > p[2] && p[0] > 150,
            "EXIF 6 must rotate 90 CW so stored top row becomes the right column; y={y} {p:?}"
        );
    }
}

#[test]
fn orientation6_swaps_stored_dimensions() {
    let path = write_orientation6_fixture();
    let stored = image::open(&path).expect("open without exif apply");
    assert_eq!(stored.dimensions(), (40, 80), "SOF stored portrait");
    let oriented = decode_path(&path).expect("decode with orientation");
    assert!(
        oriented.width() > oriented.height(),
        "oriented {}x{} should swap SOF 40x80",
        oriented.width(),
        oriented.height()
    );
    assert_eq!(oriented.dimensions(), (80, 40));
    assert_red_right_column(&oriented.pixels);

    let dir = tempfile::tempdir().expect("tmp");
    let dest = dir.path().join("oriented.jpg");
    save_oriented(&oriented, &dest).expect("persist already-oriented jpeg");
    let baked = image::open(&dest).expect("open persisted without exif apply");
    assert_eq!(
        baked.dimensions(),
        (80, 40),
        "persisted SOF must already be oriented"
    );
    assert_red_right_column(&baked.to_rgb8());
    let again = decode_path(&dest).expect("re-decode persisted");
    assert_eq!(again.dimensions(), (80, 40));
    assert_red_right_column(&again.pixels);
}

#[test]
fn png_round_trip_stays_png() {
    let dir = tempfile::tempdir().expect("tmp");
    let src = dir.path().join("in.png");
    let dest = dir.path().join("out.png");
    let img = RgbImage::from_pixel(16, 12, Rgb([9, 8, 7]));
    img.save(&src).expect("write png");
    let oriented = decode_path(&src).expect("decode png");
    assert_eq!(oriented.source_format, SourceFormat::Png);
    save_oriented(&oriented, &dest).expect("save png");
    let again = image::open(&dest).expect("reopen");
    assert_eq!(again.dimensions(), (16, 12));
}

#[test]
fn jpeg_persists_oriented_pixels() {
    let dir = tempfile::tempdir().expect("tmp");
    let src = dir.path().join("in.jpg");
    let dest = dir.path().join("out.jpg");
    let img = RgbImage::from_pixel(24, 18, Rgb([40, 50, 60]));
    fs::write(&src, jpeg_with_orientation(&img, 1)).expect("write jpeg");
    let oriented = decode_path(&src).expect("decode jpeg");
    assert_eq!(oriented.source_format, SourceFormat::Jpeg);
    save_oriented(&oriented, &dest).expect("save jpeg");
    assert!(dest.exists());
}

#[test]
fn glossy_photo_detect_does_not_panic() {
    let path = fixtures_dir().join("glossy.jpg");
    let img = if path.exists() {
        decode_path(&path).expect("decode glossy fixture").pixels
    } else {
        glossy_noisy_quad()
    };
    let result = detect_screen_quad(&img);
    assert_eq!(result.image_width, img.width());
    assert_eq!(result.image_height, img.height());
    assert!(result.confidence.is_finite());
    assert!(result.confidence <= 1.0);
    // Low confidence is acceptable; the handle editor is the reliability path.
    let _ = result.confidence < DETECT_CONFIDENCE_THRESHOLD;
    let warped = warp_quad(&img, result.corners).expect("warp glossy");
    assert!(warped.width() >= 1 && warped.height() >= 1);
}

#[test]
fn warp_clamps_long_edge_and_samples() {
    let mut img = RgbImage::from_pixel(100, 80, Rgb([0, 0, 0]));
    draw_filled_rect_mut(&mut img, Rect::at(10, 10).of_size(80, 60), Rgb([255, 0, 0]));
    let corners = [
        Point::new(10.0, 10.0),
        Point::new(89.0, 10.0),
        Point::new(89.0, 69.0),
        Point::new(10.0, 69.0),
    ];
    let (w, h) = dest_size(corners);
    assert!(w.max(h) <= MAX_WARP_LONG_EDGE);
    let out = warp_quad(&img, corners).expect("warp");
    assert_eq!(out.dimensions(), (w, h));
    let mid = out.get_pixel(w / 2, h / 2).0;
    assert!(mid[0] > 200, "center should be red, got {mid:?}");

    assert_eq!(dest_size_for_target(corners, 1920, 1080), (1920, 1080));
    let tablet = warp_quad_to(&img, corners, (1920, 1080)).expect("warp to tablet");
    assert_eq!(tablet.dimensions(), (1920, 1080));
    let tablet_mid = tablet.get_pixel(960, 540).0;
    assert!(
        tablet_mid[0] > 200,
        "tablet-sized center should be red, got {tablet_mid:?}"
    );
}

#[test]
fn heic_extension_is_unsupported_or_converted() {
    let dir = tempfile::tempdir().expect("tmp");
    let path = dir.path().join("bogus.heic");
    fs::write(&path, b"not a heic").expect("write");
    let err = decode_path(&path).expect_err("heic must fail closed or convert");
    match err {
        Error::UnsupportedImage(msg) => {
            #[cfg(target_os = "macos")]
            assert!(
                msg.contains("sips"),
                "macOS HEIC failure should mention sips, got {msg}"
            );
            #[cfg(not(target_os = "macos"))]
            assert!(
                msg.contains("macOS only"),
                "Win/Linux HEIC should be macOS-only, got {msg}"
            );
        }
        other => panic!("expected unsupported_image, got {other:?}"),
    }
}

#[cfg(target_os = "macos")]
#[test]
fn sample_heic_converts_via_sips() {
    let jpeg_path = ensure_sample_heic();
    let oriented = decode_path(&jpeg_path).expect("HEIC via sips should decode");
    assert!(oriented.width() > 0 && oriented.height() > 0);
    assert_eq!(oriented.source_format, SourceFormat::Heic);
}

#[cfg(target_os = "macos")]
fn ensure_sample_heic() -> PathBuf {
    let dir = fixtures_dir();
    fs::create_dir_all(&dir).expect("fixtures");
    let heic = dir.join("sample.heic");
    if !heic.exists() {
        let jpg = dir.join("_heic_src.jpg");
        let img = RgbImage::from_pixel(32, 24, Rgb([12, 34, 56]));
        fs::write(&jpg, encode_jpeg(&img, 90)).expect("src jpeg");
        let status = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic", "-o"])
            .arg(&heic)
            .arg(&jpg)
            .status()
            .expect("spawn sips");
        assert!(status.success(), "sips failed to write sample.heic");
        let _ = fs::remove_file(jpg);
    }
    heic
}

#[test]
fn decode_missing_file_is_io() {
    let err = decode_path(Path::new("/no/such/picoflow-image.jpg")).unwrap_err();
    assert!(matches!(err, Error::Io(_)));
}

#[test]
fn oriented_image_save_jpeg_quality_path() {
    let img = OrientedImage {
        pixels: RgbImage::from_pixel(8, 8, Rgb([1, 2, 3])),
        source_format: SourceFormat::Jpeg,
    };
    let dir = tempfile::tempdir().expect("tmp");
    let dest = dir.path().join("q.jpg");
    save_oriented(&img, &dest).expect("save");
    assert!(dest.metadata().expect("meta").len() > 0);
}
