use std::borrow::Cow;

use image::{imageops, RgbImage};
use imageproc::contours::{find_contours, BorderType};
use imageproc::edges::canny;
use imageproc::filter::gaussian_blur_f32;
use serde::{Deserialize, Serialize};

use crate::Point;

/// UI opens the four-handle editor when confidence is below this.
pub const DETECT_CONFIDENCE_THRESHOLD: f64 = 0.55;

const DETECT_LONG_EDGE: u32 = 1280;
const BLUR_SIGMA: f32 = 1.2;
const CANNY_LOW: f32 = 50.0;
const CANNY_HIGH: f32 = 150.0;
const RDP_EPSILON_FRAC: f64 = 0.02;
const INSET_FRAC: f64 = 0.05;

/// Screen-quad guess. Always populated; low confidence still includes a quad.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub corners: [Point; 4],
    pub confidence: f64,
    pub image_width: u32,
    pub image_height: u32,
}

/// Classical quad detect. Never fails: missing quad → 5% inset rectangle.
pub fn detect_screen_quad(image: &RgbImage) -> DetectResult {
    let image_width = image.width();
    let image_height = image.height();
    if image_width == 0 || image_height == 0 {
        return DetectResult {
            corners: [Point::new(0.0, 0.0); 4],
            confidence: 0.0,
            image_width,
            image_height,
        };
    }

    let (work, scale_x, scale_y) = downscale(image);
    let gray = imageops::grayscale(work.as_ref());
    let blurred = gaussian_blur_f32(&gray, BLUR_SIGMA);
    let edges = canny(&blurred, CANNY_LOW, CANNY_HIGH);

    let epsilon = RDP_EPSILON_FRAC * f64::from(work.width().max(work.height()));
    let frame_area = f64::from(work.width()) * f64::from(work.height());
    let mut best: Option<(f64, [Point; 4])> = None;

    for contour in find_contours::<i32>(&edges) {
        if contour.border_type != BorderType::Outer || contour.points.len() < 4 {
            continue;
        }
        let pts: Vec<Point> = contour
            .points
            .iter()
            .map(|p| Point::new(f64::from(p.x), f64::from(p.y)))
            .collect();
        let Some(quad) = contour_to_quad(&pts, epsilon) else {
            continue;
        };
        let score = score_quad(&quad, frame_area);
        if best
            .as_ref()
            .is_none_or(|(best_score, _)| score > *best_score)
        {
            best = Some((score, quad));
        }
    }

    let (confidence, corners) = match best {
        Some((score, quad)) => {
            let mapped = [
                Point::new(quad[0].x * scale_x, quad[0].y * scale_y),
                Point::new(quad[1].x * scale_x, quad[1].y * scale_y),
                Point::new(quad[2].x * scale_x, quad[2].y * scale_y),
                Point::new(quad[3].x * scale_x, quad[3].y * scale_y),
            ];
            (score.clamp(0.0, 1.0), order_corners(mapped))
        }
        None => (0.0, inset_rectangle(image_width, image_height)),
    };

    DetectResult {
        corners,
        confidence,
        image_width,
        image_height,
    }
}

fn downscale(image: &RgbImage) -> (Cow<'_, RgbImage>, f64, f64) {
    let w = image.width();
    let h = image.height();
    let long = w.max(h);
    if long <= DETECT_LONG_EDGE {
        return (Cow::Borrowed(image), 1.0, 1.0);
    }
    let scale = f64::from(DETECT_LONG_EDGE) / f64::from(long);
    let nw = (f64::from(w) * scale).round().max(1.0) as u32;
    let nh = (f64::from(h) * scale).round().max(1.0) as u32;
    let resized = imageops::resize(image, nw, nh, imageops::FilterType::Triangle);
    (
        Cow::Owned(resized),
        f64::from(w) / f64::from(nw),
        f64::from(h) / f64::from(nh),
    )
}

fn contour_to_quad(points: &[Point], epsilon: f64) -> Option<[Point; 4]> {
    let hull = convex_hull(points);
    if hull.len() < 4 {
        return None;
    }
    let approx = rdp_closed(&hull, epsilon);
    let quad = if approx.len() == 4 {
        [approx[0], approx[1], approx[2], approx[3]]
    } else if (5..=16).contains(&approx.len()) {
        force_quad(approx)?
    } else {
        return None;
    };
    if is_convex(&quad) && polygon_area(&quad) > 1.0 {
        Some(order_corners(quad))
    } else {
        None
    }
}

fn force_quad(mut pts: Vec<Point>) -> Option<[Point; 4]> {
    if pts.len() < 4 {
        return None;
    }
    while pts.len() > 4 {
        let n = pts.len();
        let mut best_i = 0;
        let mut best_ang = f64::MIN;
        for i in 0..n {
            let ang = corner_angle(pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]);
            if ang > best_ang {
                best_ang = ang;
                best_i = i;
            }
        }
        pts.remove(best_i);
    }
    Some([pts[0], pts[1], pts[2], pts[3]])
}

fn score_quad(quad: &[Point; 4], frame_area: f64) -> f64 {
    let area = polygon_area(quad).abs();
    let frac = if frame_area > 0.0 {
        area / frame_area
    } else {
        0.0
    };
    let (rect_w, rect_h, rect_area) = min_area_rect(quad);
    let rectangularity = if rect_area > 1e-6 {
        (area / rect_area).clamp(0.0, 1.0)
    } else {
        0.0
    };
    // rect_w/rect_h is long/short of the min-area rect; [0.4, 2.5] original ↔ long/short ≤ 2.5.
    let aspect = if rect_h > 1e-6 {
        rect_w / rect_h
    } else {
        f64::MAX
    };

    let mut angle_dev = 0.0;
    for i in 0..4 {
        let ang = corner_angle(quad[(i + 3) % 4], quad[i], quad[(i + 1) % 4]);
        angle_dev += (ang - 90.0).abs();
    }
    let angle_score = (1.0 - (angle_dev / 4.0) / 90.0).clamp(0.0, 1.0);
    let area_score = area_fraction_score(frac);
    let aspect_score = if aspect <= 2.5 { 1.0 } else { 0.0 };

    (area_score * angle_score * aspect_score * rectangularity).clamp(0.0, 1.0)
}

fn area_fraction_score(frac: f64) -> f64 {
    if (0.15..=0.90).contains(&frac) {
        1.0
    } else if frac < 0.15 {
        (frac / 0.15).clamp(0.0, 1.0)
    } else {
        ((1.0 - frac) / 0.10).clamp(0.0, 1.0)
    }
}

fn min_area_rect(quad: &[Point; 4]) -> (f64, f64, f64) {
    let mut best = (f64::MAX, 1.0, 1.0);
    for i in 0..4 {
        let a = quad[i];
        let b = quad[(i + 1) % 4];
        let (ex, ey) = (b.x - a.x, b.y - a.y);
        let len = ex.hypot(ey).max(1e-9);
        let (ux, uy) = (ex / len, ey / len);
        let (px, py) = (-uy, ux);
        let mut min_u = f64::MAX;
        let mut max_u = f64::MIN;
        let mut min_p = f64::MAX;
        let mut max_p = f64::MIN;
        for q in quad {
            let vx = q.x - a.x;
            let vy = q.y - a.y;
            let u = vx * ux + vy * uy;
            let p = vx * px + vy * py;
            min_u = min_u.min(u);
            max_u = max_u.max(u);
            min_p = min_p.min(p);
            max_p = max_p.max(p);
        }
        let w = (max_u - min_u).abs();
        let h = (max_p - min_p).abs();
        let area = w * h;
        if area < best.0 {
            best = (area, w.max(h), w.min(h));
        }
    }
    let (area, long, short) = best;
    (long, short.max(1e-9), area)
}

fn polygon_area(pts: &[Point]) -> f64 {
    let n = pts.len();
    if n < 3 {
        return 0.0;
    }
    let mut acc = 0.0;
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        acc += a.x * b.y - b.x * a.y;
    }
    (acc / 2.0).abs()
}

fn corner_angle(prev: Point, curr: Point, next: Point) -> f64 {
    let v1x = prev.x - curr.x;
    let v1y = prev.y - curr.y;
    let v2x = next.x - curr.x;
    let v2y = next.y - curr.y;
    let dot = v1x * v2x + v1y * v2y;
    let cross = v1x * v2y - v1y * v2x;
    cross.atan2(dot).abs().to_degrees()
}

fn is_convex(pts: &[Point]) -> bool {
    if pts.len() < 3 {
        return false;
    }
    let mut sign = 0i32;
    let n = pts.len();
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        let c = pts[(i + 2) % n];
        let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if cross.abs() < 1e-6 {
            continue;
        }
        let s = if cross > 0.0 { 1 } else { -1 };
        if sign == 0 {
            sign = s;
        } else if sign != s {
            return false;
        }
    }
    sign != 0
}

/// TL, TR, BR, BL via x+y / x−y extrema.
pub(crate) fn order_corners(pts: [Point; 4]) -> [Point; 4] {
    let mut tl = pts[0];
    let mut tr = pts[0];
    let mut br = pts[0];
    let mut bl = pts[0];
    let mut min_sum = f64::MAX;
    let mut max_sum = f64::MIN;
    let mut min_diff = f64::MAX;
    let mut max_diff = f64::MIN;
    for p in pts {
        let sum = p.x + p.y;
        let diff = p.x - p.y;
        if sum < min_sum {
            min_sum = sum;
            tl = p;
        }
        if sum > max_sum {
            max_sum = sum;
            br = p;
        }
        if diff > max_diff {
            max_diff = diff;
            tr = p;
        }
        if diff < min_diff {
            min_diff = diff;
            bl = p;
        }
    }
    [tl, tr, br, bl]
}

fn inset_rectangle(width: u32, height: u32) -> [Point; 4] {
    let w = f64::from(width);
    let h = f64::from(height);
    let mx = (w * INSET_FRAC).min(w / 2.0);
    let my = (h * INSET_FRAC).min(h / 2.0);
    let x1 = (w - 1.0 - mx).max(mx);
    let y1 = (h - 1.0 - my).max(my);
    [
        Point::new(mx, my),
        Point::new(x1, my),
        Point::new(x1, y1),
        Point::new(mx, y1),
    ]
}

fn convex_hull(points: &[Point]) -> Vec<Point> {
    let mut pts = points.to_vec();
    pts.sort_by(|a, b| {
        a.x.partial_cmp(&b.x)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
    });
    pts.dedup_by(|a, b| (a.x - b.x).abs() < 1e-9 && (a.y - b.y).abs() < 1e-9);
    if pts.len() <= 3 {
        return pts;
    }

    let mut lower = Vec::new();
    for p in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], *p) <= 0.0 {
            lower.pop();
        }
        lower.push(*p);
    }
    let mut upper = Vec::new();
    for p in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], *p) <= 0.0 {
            upper.pop();
        }
        upper.push(*p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

fn cross(o: Point, a: Point, b: Point) -> f64 {
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

fn rdp_closed(points: &[Point], epsilon: f64) -> Vec<Point> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut max_d = 0.0;
    let mut i1 = 0usize;
    let mut i2 = 1usize;
    for i in 0..points.len() {
        for j in (i + 1)..points.len() {
            let d = points[i].dist(points[j]);
            if d > max_d {
                max_d = d;
                i1 = i;
                i2 = j;
            }
        }
    }
    let mut rotated = Vec::with_capacity(points.len());
    rotated.extend_from_slice(&points[i1..]);
    rotated.extend_from_slice(&points[..i1]);
    let i2_rot = if i2 >= i1 {
        i2 - i1
    } else {
        i2 + points.len() - i1
    };
    let chain1: Vec<Point> = rotated[..=i2_rot].to_vec();
    let mut chain2: Vec<Point> = rotated[i2_rot..].to_vec();
    chain2.push(rotated[0]);
    let mut left = rdp(&chain1, epsilon);
    let mut right = rdp(&chain2, epsilon);
    if left.len() > 1 {
        left.pop();
    }
    if right.len() > 1 {
        right.pop();
    }
    left.extend(right);
    left
}

fn rdp(points: &[Point], epsilon: f64) -> Vec<Point> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let first = points[0];
    let last = points[points.len() - 1];
    let mut max_dist = 0.0;
    let mut index = 0usize;
    for (i, p) in points
        .iter()
        .enumerate()
        .skip(1)
        .take(points.len().saturating_sub(2))
    {
        let d = perpendicular_distance(*p, first, last);
        if d > max_dist {
            max_dist = d;
            index = i;
        }
    }
    if max_dist > epsilon {
        let mut left = rdp(&points[..=index], epsilon);
        let right = rdp(&points[index..], epsilon);
        left.pop();
        left.extend(right);
        left
    } else {
        vec![first, last]
    }
}

fn perpendicular_distance(p: Point, a: Point, b: Point) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = dx.hypot(dy);
    if len < 1e-9 {
        return p.dist(a);
    }
    ((p.x - a.x) * dy - (p.y - a.y) * dx).abs() / len
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn downscale_borrows_when_already_within_long_edge() {
        let img = RgbImage::from_pixel(100, 80, Rgb([1, 2, 3]));
        let (work, scale_x, scale_y) = downscale(&img);
        assert_eq!(scale_x, 1.0);
        assert_eq!(scale_y, 1.0);
        assert!(matches!(work, Cow::Borrowed(_)));
        assert_eq!(work.width(), 100);
        assert_eq!(work.height(), 80);
    }

    #[test]
    fn downscale_resizes_when_longer_than_detect_edge() {
        let img = RgbImage::from_pixel(DETECT_LONG_EDGE + 200, 400, Rgb([1, 2, 3]));
        let (work, scale_x, scale_y) = downscale(&img);
        assert!(matches!(work, Cow::Owned(_)));
        assert_eq!(work.width().max(work.height()), DETECT_LONG_EDGE);
        assert!(scale_x > 1.0);
        assert!(scale_y > 1.0);
    }
}
