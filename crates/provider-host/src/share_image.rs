//! Image-only VUA carrier. No network, paths, platform credentials or application state.
use datamatrix::{DataMatrix, SymbolSize};
use image::{AnimationDecoder, ImageDecoder};
use image::{DynamicImage, GrayImage, Luma, Rgba, RgbaImage};
use std::borrow::Cow;
use std::io::Cursor;

pub const PLATE: u8 = 240;
pub const CONTRAST: u8 = 2;
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 16 * 1024 * 1024;
const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Clone, Copy, Debug)]
pub enum Position {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

pub fn normalize_code(code: &str) -> Option<String> {
    if code.len() != 12 || !code.is_ascii() {
        return None;
    }
    let upper = code.to_ascii_uppercase();
    upper
        .bytes()
        .all(|value| ALPHABET.contains(&value))
        .then_some(upper)
}

fn symbol(code: &str) -> Result<(Vec<bool>, usize, usize), String> {
    let code = normalize_code(code).ok_or("share_code_invalid")?;
    let matrix = DataMatrix::encode(format!("VU1:{code}").as_bytes(), SymbolSize::Rect12x26)
        .map_err(|_| "share_code_invalid")?;
    let bitmap = matrix.bitmap();
    let (width, height) = (bitmap.width(), bitmap.height());
    let mut pixels = vec![false; width * height];
    for (x, y) in bitmap.pixels() {
        pixels[y * width + x] = true;
    }
    Ok((pixels, width, height))
}

/// Eight-pixel modules align with JPEG blocks; the plate remains outside a 5% crop.
pub fn mark(
    input: &RgbaImage,
    code: &str,
    position: Position,
    contrast: u8,
) -> Result<RgbaImage, String> {
    if input.width() < 512 || input.height() < 256 || !(1..=16).contains(&contrast) {
        return Err("share_image_dimensions".into());
    }
    let (bits, columns, rows) = symbol(code)?;
    let module = (input.width() / 1024).max(1) * 8;
    let (width, height) = (
        (columns as u32 + 4) * module + 64 * module / 8,
        (rows as u32 + 4) * module,
    );
    let padding = ((input.width().min(input.height()) * 8 / 100) / 8) * 8;
    if width + 2 * padding > input.width() || height + 2 * padding > input.height() {
        return Err("share_image_dimensions".into());
    }
    let left = match position {
        Position::TopLeft | Position::BottomLeft => padding,
        _ => input.width() - width - padding,
    };
    let top = match position {
        Position::TopLeft | Position::TopRight => padding,
        _ => input.height() - height - padding,
    };
    let mut output = input.clone();
    for y in top..top + height {
        for x in left..left + width {
            output.put_pixel(x, y, Rgba([PLATE, PLATE, PLATE, 255]));
        }
    }
    let start_x = left + 64 * module / 8;
    for y in 0..height {
        for x in 0..width - (start_x - left) {
            let (column, row) = (x / module, y / module);
            let black = column >= 2
                && row >= 2
                && column < columns as u32 + 2
                && row < rows as u32 + 2
                && bits[(row as usize - 2) * columns + column as usize - 2];
            let value = if black {
                PLATE - contrast
            } else {
                PLATE + contrast
            };
            output.put_pixel(start_x + x, top + y, Rgba([value, value, value, 255]));
        }
    }
    Ok(output)
}

fn residual(image: &RgbaImage) -> GrayImage {
    GrayImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        let min = *pixel.0[..3].iter().min().unwrap();
        let max = *pixel.0[..3].iter().max().unwrap();
        if pixel[3] < 128 || max - min > 12 {
            return Luma([255]);
        }
        let base = [PLATE, 158, 206]
            .into_iter()
            .min_by_key(|base| (i16::from(pixel[0]) - i16::from(*base)).abs())
            .unwrap();
        if (i16::from(pixel[0]) - i16::from(base)).abs() > 16 {
            return Luma([255]);
        }
        let average = (i16::from(pixel[0]) + i16::from(pixel[1]) + i16::from(pixel[2])) / 3;
        Luma([((average - i16::from(base)) * 24 + 128).clamp(0, 255) as u8])
    })
}

/// Locate the controlled plate before asking a general detector to search a busy image.
/// Sampling the known 26-by-12 ECC200 grid also survives a damaged finder edge.
fn read_plate(image: &RgbaImage) -> Option<String> {
    let near = |x: u32, y: u32| {
        let p = image.get_pixel(x, y);
        let lo = *p.0[..3].iter().min().unwrap();
        let hi = *p.0[..3].iter().max().unwrap();
        p[3] >= 128 && hi - lo <= 12 && (228..=252).contains(&p[0])
    };
    let mut attempted = Vec::new();
    for y in (0..image.height()).step_by((image.height() / 200).max(1) as usize) {
        let mut x = 0;
        while x < image.width() {
            if !near(x, y) {
                x += 1;
                continue;
            }
            let left = x;
            while x < image.width() && near(x, y) {
                x += 1;
            }
            let width = x - left;
            if width < image.width() / 6 || width < 38 {
                continue;
            }
            let center = left + width / 2;
            let mut top = y;
            while top > 0 && near(center, top - 1) {
                top -= 1;
            }
            let mut bottom = y + 1;
            while bottom < image.height() && near(center, bottom) {
                bottom += 1;
            }
            let height = bottom - top;
            if height < 16 || width * 100 < height * 218 || width * 100 > height * 255 {
                continue;
            }
            let key = (left / 4, top / 4, width / 4, height / 4);
            if attempted.contains(&key) {
                continue;
            }
            attempted.push(key);
            if attempted.len() > 32 {
                return None;
            }
            for dx in [-1.0, 0.0, 1.0] {
                for dy in [-1.0, 0.0, 1.0] {
                    let mut bits = Vec::with_capacity(312);
                    for row in 0..12 {
                        for column in 0..26 {
                            let cx = (left as f64
                                + (10.5 + f64::from(column)) * f64::from(width) / 38.0
                                + dx)
                                .round()
                                .clamp(0.0, f64::from(image.width() - 1))
                                as u32;
                            let cy = (top as f64
                                + (2.5 + f64::from(row)) * f64::from(height) / 16.0
                                + dy)
                                .round()
                                .clamp(0.0, f64::from(image.height() - 1))
                                as u32;
                            let p = image.get_pixel(cx, cy);
                            bits.push(
                                u16::from(p[0]) + u16::from(p[1]) + u16::from(p[2])
                                    < u16::from(PLATE) * 3,
                            );
                        }
                    }
                    if let Ok(bytes) = DataMatrix::decode(&bits, 26) {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            if let Some(code) = text.strip_prefix("VU1:").and_then(normalize_code) {
                                return Some(code);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn read_code(image: &RgbaImage) -> Result<String, String> {
    if u64::from(image.width()) * u64::from(image.height()) > MAX_IMAGE_PIXELS {
        return Err("share_image_too_large".into());
    }
    if let Some(code) = read_plate(image) {
        return Ok(code);
    }
    let gray = residual(image);
    let mut candidates = vec![gray.clone()];
    let (width, height) = (
        gray.width() * 3 / 4,
        gray.height().min(gray.width() * 2 / 5),
    );
    if width > 32 && height > 16 {
        for x in [0, gray.width() - width] {
            for y in [0, gray.height() - height] {
                candidates.push(image::imageops::crop_imm(&gray, x, y, width, height).to_image());
            }
        }
    }
    for candidate in candidates {
        let (width, height) = candidate.dimensions();
        if let Ok(result) = rxing::helpers::detect_in_luma(
            candidate.into_raw(),
            width,
            height,
            Some(rxing::BarcodeFormat::DATA_MATRIX),
        ) {
            if let Some(code) = result
                .getText()
                .strip_prefix("VU1:")
                .and_then(normalize_code)
            {
                return Ok(code);
            }
        }
    }
    Err("share_image_no_code".into())
}

pub fn bounded_image(bytes: &[u8]) -> Result<RgbaImage, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("share_image_too_large".into());
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "share_image_invalid")?;
    if !matches!(
        reader.format(),
        Some(
            image::ImageFormat::Png
                | image::ImageFormat::Jpeg
                | image::ImageFormat::Gif
                | image::ImageFormat::WebP
        )
    ) {
        return Err("share_image_invalid".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "share_image_invalid")?;
    if u64::from(image.width()) * u64::from(image.height()) > MAX_IMAGE_PIXELS {
        return Err("share_image_too_large".into());
    }
    Ok(image.into_rgba8())
}

pub fn png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut output = std::io::Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "share_image_encode")?;
    Ok(output.into_inner())
}

/// Reuse the accepted application's VUA geometry, with no generated replacement logo.
pub fn decorate(
    image: &RgbaImage,
    code: Option<&str>,
    position: Position,
) -> Result<RgbaImage, String> {
    if image.width() < 512 || image.height() < 256 {
        return Err("share_image_dimensions".into());
    }
    let mut output = if let Some(code) = code {
        mark(image, code, position, CONTRAST)?
    } else {
        image.clone()
    };
    if let Some(code) = code {
        background_repeats(&mut output, code)?;
    }
    let scale = (image.width() / 1024).max(1);
    let padding = ((image.width().min(image.height()) * 8 / 100) / 8) * 8;
    static BASE_LOGO: std::sync::LazyLock<Option<RgbaImage>> = std::sync::LazyLock::new(|| {
        image::load_from_memory(include_bytes!("../assets/vua-mark.png"))
            .ok()
            .map(|img| img.into_rgba8())
    });
    let logo = BASE_LOGO.as_ref().ok_or("share_image_encode")?;
    let size = 48 * scale;
    let (plate_width, plate_height) = if code.is_some() {
        (304 * scale, 128 * scale)
    } else {
        (size, size)
    };
    let left = match position {
        Position::TopLeft | Position::BottomLeft => padding,
        _ => image.width() - plate_width - padding,
    };
    let top = match position {
        Position::TopLeft | Position::TopRight => padding,
        _ => image.height() - plate_height - padding,
    };
    let logo = image::imageops::resize(logo, size, size, image::imageops::FilterType::Lanczos3);
    image::imageops::overlay(
        &mut output,
        &logo,
        i64::from(left + if code.is_some() { 8 * scale } else { 0 }),
        i64::from(top + if code.is_some() { 24 * scale } else { 0 }),
    );
    if code.is_some() {
        // Five-by-seven lowercase letters form the small brand word, independent of OS fonts.
        let glyphs: [[u8; 7]; 6] = [
            [4, 0, 12, 4, 4, 4, 14],
            [0, 0, 22, 25, 17, 17, 17],
            [0, 0, 15, 16, 14, 1, 30],
            [4, 0, 12, 4, 4, 4, 14],
            [1, 1, 15, 17, 17, 17, 15],
            [0, 0, 14, 17, 31, 16, 15],
        ];
        for (letter, rows) in glyphs.iter().enumerate() {
            for (y, row) in rows.iter().enumerate() {
                for x in 0..5 {
                    if row & (1 << (4 - x)) != 0 {
                        for dy in 0..scale {
                            for dx in 0..scale {
                                output.put_pixel(
                                    left + (14 + letter as u32 * 6 + x) * scale + dx,
                                    top + (88 + y as u32) * scale + dy,
                                    Rgba([45, 40, 62, 255]),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(output)
}

/// Only a completely uniform known Unity neutral region can carry a repeat. This
/// pixel test excludes the Avatar silhouette; arbitrary photographs use the badge only.
fn background_repeats(image: &mut RgbaImage, code: &str) -> Result<(), String> {
    let (bits, columns, rows) = symbol(code)?;
    let module = (image.width() / 1024).max(1) * 8;
    let (width, height) = ((columns as u32 + 4) * module, (rows as u32 + 4) * module);
    let padding = ((image.width().min(image.height()) * 8 / 100) / 8) * 8;
    if width + 2 * padding > image.width() || height + 2 * padding > image.height() {
        return Ok(());
    }
    for left in [padding, image.width() - width - padding] {
        let top = padding;
        let base = image.get_pixel(left, top)[0];
        if ![158, 206].contains(&base) {
            continue;
        }
        if (top..top + height).any(|y| {
            (left..left + width).any(|x| image.get_pixel(x, y).0 != [base, base, base, 255])
        }) {
            continue;
        }
        for y in 0..height {
            for x in 0..width {
                let (column, row) = (x / module, y / module);
                let black = column >= 2
                    && row >= 2
                    && column < columns as u32 + 2
                    && row < rows as u32 + 2
                    && bits[(row as usize - 2) * columns + column as usize - 2];
                let value = if black {
                    base - CONTRAST
                } else {
                    base + CONTRAST
                };
                image.put_pixel(left + x, top + y, Rgba([value, value, value, 255]));
            }
        }
    }
    Ok(())
}

/// GIF keeps both carrier grays as exact palette entries and never dithers the carrier.
pub fn animation<F>(mut frame: F, code: Option<&str>) -> Result<(Vec<u8>, u32, u32), String>
where
    F: FnMut(u32) -> Result<RgbaImage, String>,
{
    for (side, stride) in [(1024, 1), (768, 1), (512, 1), (512, 2), (512, 3), (512, 6)] {
        let mut bytes = Vec::new();
        {
            let mut encoder = gif::Encoder::new(&mut bytes, side as u16, side as u16, &[])
                .map_err(|_| "share_image_encode")?;
            encoder
                .set_repeat(gif::Repeat::Infinite)
                .map_err(|_| "share_image_encode")?;
            for index in (0..60).step_by(stride) {
                let source = frame(index)?;
                let resized = image::imageops::resize(
                    &source,
                    side,
                    side,
                    image::imageops::FilterType::Lanczos3,
                );
                let image = decorate(&resized, code, Position::BottomRight)?;
                let quantizer = color_quant::NeuQuant::new(10, 247, image.as_raw());
                let grays = [
                    PLATE - CONTRAST,
                    PLATE + CONTRAST,
                    PLATE,
                    158 - CONTRAST,
                    158 + CONTRAST,
                    158,
                    206 - CONTRAST,
                    206 + CONTRAST,
                    206,
                ];
                let mut palette = grays.iter().flat_map(|v| [*v, *v, *v]).collect::<Vec<_>>();
                palette.extend_from_slice(&quantizer.color_map_rgb());
                let indices = image
                    .pixels()
                    .map(|pixel| {
                        if pixel[0] == pixel[1] && pixel[1] == pixel[2] {
                            if let Some(index) = grays.iter().position(|v| *v == pixel[0]) {
                                return index as u8;
                            }
                        }
                        quantizer.index_of(&pixel.0) as u8 + 9
                    })
                    .collect::<Vec<_>>();
                let gif_frame = gif::Frame {
                    width: side as u16,
                    height: side as u16,
                    delay: 8 * stride as u16,
                    palette: Some(palette),
                    buffer: Cow::Owned(indices),
                    ..Default::default()
                };
                encoder
                    .write_frame(&gif_frame)
                    .map_err(|_| "share_image_encode")?;
            }
        }
        if bytes.len() <= 8 * 1024 * 1024 {
            return Ok((bytes, side, 60_u32.div_ceil(stride as u32)));
        }
    }
    Err("share_image_too_large".into())
}

pub fn read_image(bytes: &[u8]) -> Result<(String, RgbaImage), String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("share_image_too_large".into());
    }
    if matches!(image::guess_format(bytes), Ok(image::ImageFormat::Gif)) {
        let mut decoder = image::codecs::gif::GifDecoder::new(Cursor::new(bytes))
            .map_err(|_| "share_image_invalid")?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        limits.max_alloc = Some(128 * 1024 * 1024);
        decoder
            .set_limits(limits)
            .map_err(|_| "share_image_too_large")?;
        let mut pixels = 0_u64;
        for (index, frame) in decoder.into_frames().enumerate() {
            if index >= 120 {
                return Err("share_image_too_large".into());
            }
            let frame = frame.map_err(|_| "share_image_invalid")?.into_buffer();
            pixels += u64::from(frame.width()) * u64::from(frame.height());
            if pixels > 64 * 1024 * 1024 {
                return Err("share_image_too_large".into());
            }
            if let Ok(code) = read_code(&frame) {
                return Ok((code, frame));
            }
        }
        return Err("share_image_no_code".into());
    }
    let image = bounded_image(bytes)?;
    Ok((read_code(&image)?, image))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn background(kind: u32) -> RgbaImage {
        RgbaImage::from_fn(1024, 1024, |x, y| {
            let gray = match kind {
                0 => 158,
                1 => (45 + x / 8 + y / 16).min(220) as u8,
                2 => {
                    if (x / 3 + y / 3) % 2 == 0 {
                        30
                    } else {
                        225
                    }
                }
                _ => (((x.wrapping_mul(73856093) ^ y.wrapping_mul(19349663)) >> 8) % 220) as u8,
            };
            let silhouette = (400..624).contains(&x) && (180..970).contains(&y);
            if silhouette {
                Rgba([32, 45, 67, 255])
            } else {
                Rgba([gray, gray, gray, 255])
            }
        })
    }
    #[test]
    fn carrier_transforms_select_the_minimum_contrast() {
        let mut best = None;
        for contrast in 1..=12 {
            let mut good = 0;
            let mut total = 0;
            'cases: for (kind, code) in [
                "3P3J7H0EGWP1",
                "NF5MQDQ4N075",
                "4X82FFD451H4",
                "N5JWEY1QS9V2",
            ]
            .iter()
            .enumerate()
            {
                let position = [
                    Position::TopLeft,
                    Position::TopRight,
                    Position::BottomLeft,
                    Position::BottomRight,
                ][kind];
                let encoded = mark(&background(kind as u32), code, position, contrast).unwrap();
                for size in [1024, 768, 512, 680, 1200, 2048] {
                    let resized = image::imageops::resize(
                        &encoded,
                        size,
                        size,
                        image::imageops::FilterType::Lanczos3,
                    );
                    for quality in [85, 75] {
                        let mut bytes = Vec::new();
                        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
                            .encode_image(&DynamicImage::ImageRgba8(resized.clone()).to_rgb8())
                            .unwrap();
                        let decoded = bounded_image(&bytes).unwrap();
                        for crop in [false, true] {
                            let border = if crop { size / 20 } else { 0 };
                            let cropped = image::imageops::crop_imm(
                                &decoded,
                                border,
                                border,
                                size - 2 * border,
                                size - 2 * border,
                            )
                            .to_image();
                            total += 1;
                            if read_code(&cropped).as_deref() == Ok(*code) {
                                good += 1;
                            } else {
                                println!("reject contrast={contrast}: background={kind} size={size} q={quality} crop={crop}; even all remaining successes give at most 95/96 (<99%)");
                                break 'cases;
                            }
                        }
                    }
                }
            }
            println!("carrier contrast={contrast} decoded={good}/{total}");
            if total == 96 && good == 96 {
                best = Some(contrast);
                break;
            }
        }
        assert_eq!(
            best,
            Some(CONTRAST),
            "update the documented minimum only after the complete matrix passes"
        );
    }
    #[test]
    fn badges_neutral_repeats_and_plain_images() {
        for kind in 0..4 {
            let image = background(kind);
            assert!(read_code(&image).is_err());
            assert!(read_code(&decorate(&image, None, Position::BottomRight).unwrap()).is_err());
            for position in [
                Position::TopLeft,
                Position::TopRight,
                Position::BottomLeft,
                Position::BottomRight,
            ] {
                let encoded = decorate(&image, Some("3P3J7H0EGWP1"), position).unwrap();
                assert_eq!(read_code(&encoded).unwrap(), "3P3J7H0EGWP1");
            }
        }
        let mut repeated =
            decorate(&background(0), Some("NF5MQDQ4N075"), Position::BottomRight).unwrap();
        // Remove the badge: a neutral-region copy must still be readable.
        for y in 800..1024 {
            for x in 600..1024 {
                repeated.put_pixel(x, y, Rgba([158, 158, 158, 255]));
            }
        }
        assert_eq!(read_code(&repeated).unwrap(), "NF5MQDQ4N075");
        assert!(bounded_image(b"this is not an image").is_err());
        assert!(read_image(&vec![0; MAX_IMAGE_BYTES + 1]).is_err());
        assert!(normalize_code("OOOOOOOOOOOO").is_none());
        if let Ok(directory) = std::env::var("VUA_SHARE_TEST_EVIDENCE") {
            let original = background(0);
            let marked = decorate(&original, Some("3P3J7H0EGWP1"), Position::BottomRight).unwrap();
            let mut comparison = RgbaImage::new(848, 224);
            for (index, source) in [&original, &marked].iter().enumerate() {
                let corner = image::imageops::crop_imm(*source, 600, 800, 424, 224).to_image();
                image::imageops::overlay(&mut comparison, &corner, (index * 424) as i64, 0);
            }
            let comparison = image::imageops::resize(
                &comparison,
                2544,
                672,
                image::imageops::FilterType::Nearest,
            );
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                std::path::Path::new(&directory).join("badge-comparison.png"),
                png(&comparison).unwrap(),
            )
            .unwrap();
            std::fs::write(
                std::path::Path::new(&directory).join("synthetic-original.png"),
                png(&original).unwrap(),
            )
            .unwrap();
            std::fs::write(
                std::path::Path::new(&directory).join("synthetic-shared.png"),
                png(&marked).unwrap(),
            )
            .unwrap();
        }
    }
    #[test]
    fn gif_palette_size_and_later_frame_reading() {
        let (bytes, side, frames) = animation(|_| Ok(background(0)), Some("3P3J7H0EGWP1")).unwrap();
        assert!(bytes.len() <= 8 * 1024 * 1024);
        assert_eq!(frames, 60);
        assert!(side >= 512);
        assert_eq!(read_image(&bytes).unwrap().0, "3P3J7H0EGWP1");
        let plain = RgbaImage::from_pixel(512, 512, Rgba([90, 90, 90, 255]));
        let marked = decorate(&plain, Some("NF5MQDQ4N075"), Position::BottomRight).unwrap();
        let mut gif = Cursor::new(Vec::new());
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
            encoder.encode_frame(image::Frame::new(plain)).unwrap();
            encoder.encode_frame(image::Frame::new(marked)).unwrap();
        }
        assert_eq!(read_image(gif.get_ref()).unwrap().0, "NF5MQDQ4N075");
    }
}
