// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! How a document's bytes become text and back. UTF-8 is the norm; a
//! byte-order mark announces UTF-8 or UTF-16, and anything that is not
//! valid UTF-8 is read as Windows-1252, the superset of Latin-1 that
//! Windows tools wrote for decades. Every byte has a meaning in
//! Windows-1252, so a file always opens, and because that mapping is a
//! bijection the same bytes come back on save. Nothing is ever replaced
//! with U+FFFD: a character that an encoding cannot hold is an error, and
//! the frontend offers to convert the document to UTF-8 instead.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    #[serde(rename = "windows-1252")]
    Windows1252,
}

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Windows-1252 bytes 0x80..=0x9F; the rest of the byte range is Latin-1.
/// The five bytes Microsoft left undefined map to the C1 controls, as the
/// WHATWG encoding standard has them, so the table stays a bijection.
const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{0081}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{008D}', '\u{017D}', '\u{008F}',
    '\u{0090}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{009D}', '\u{017E}', '\u{0178}',
];

/// Text and the encoding it was read with. Never fails: what is not UTF-8
/// or marked UTF-16 is Windows-1252.
pub fn decode(bytes: &[u8]) -> (String, Encoding) {
    if let Some(rest) = bytes.strip_prefix(UTF8_BOM) {
        if let Ok(text) = std::str::from_utf8(rest) {
            return (text.to_owned(), Encoding::Utf8Bom);
        }
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        if let Some(text) = decode_utf16(rest, u16::from_le_bytes) {
            return (text, Encoding::Utf16Le);
        }
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        if let Some(text) = decode_utf16(rest, u16::from_be_bytes) {
            return (text, Encoding::Utf16Be);
        }
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_owned(), Encoding::Utf8);
    }
    let text = bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize],
            _ => b as char,
        })
        .collect();
    (text, Encoding::Windows1252)
}

fn decode_utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| unit([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

/// The bytes to write for `text` in `encoding`, or which character cannot
/// be written in it.
pub fn encode(text: &str, encoding: Encoding) -> Result<Vec<u8>, String> {
    match encoding {
        Encoding::Utf8 => Ok(text.as_bytes().to_vec()),
        Encoding::Utf8Bom => {
            let mut out = UTF8_BOM.to_vec();
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        Encoding::Utf16Le => Ok(encode_utf16(text, &[0xFF, 0xFE], u16::to_le_bytes)),
        Encoding::Utf16Be => Ok(encode_utf16(text, &[0xFE, 0xFF], u16::to_be_bytes)),
        Encoding::Windows1252 => text
            .chars()
            .map(|c| {
                let code = c as u32;
                if code < 0x80 || (0xA0..=0xFF).contains(&code) {
                    Ok(code as u8)
                } else {
                    CP1252_HIGH
                        .iter()
                        .position(|&h| h == c)
                        .map(|i| 0x80 + i as u8)
                        .ok_or_else(|| {
                            format!(
                                "“{c}” (U+{code:04X}) cannot be written in Windows-1252. Convert the document to UTF-8 (click the encoding in the status bar) and save again."
                            )
                        })
                }
            })
            .collect(),
    }
}

fn encode_utf16(text: &str, bom: &[u8], unit: fn(u16) -> [u8; 2]) -> Vec<u8> {
    let mut out = bom.to_vec();
    for u in text.encode_utf16() {
        out.extend_from_slice(&unit(u));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_utf8_round_trips_and_is_labelled_utf8() {
        let (text, encoding) = decode("héllo\r\n".as_bytes());
        assert_eq!((text.as_str(), encoding), ("héllo\r\n", Encoding::Utf8));
        assert_eq!(encode(&text, encoding).unwrap(), "héllo\r\n".as_bytes());
        assert_eq!(decode(b""), (String::new(), Encoding::Utf8));
    }

    #[test]
    fn byte_order_marks_pick_utf8_bom_and_utf16_and_come_back_on_save() {
        let bom = [0xEF, 0xBB, 0xBF, b'h', b'i'];
        let (text, encoding) = decode(&bom);
        assert_eq!((text.as_str(), encoding), ("hi", Encoding::Utf8Bom));
        assert_eq!(encode(&text, encoding).unwrap(), bom);

        let le = [0xFF, 0xFE, b'h', 0, 0xE9, 0, b'\n', 0];
        let (text, encoding) = decode(&le);
        assert_eq!((text.as_str(), encoding), ("hé\n", Encoding::Utf16Le));
        assert_eq!(encode(&text, encoding).unwrap(), le);

        let be = [0xFE, 0xFF, 0, b'h', 0x20, 0xAC];
        let (text, encoding) = decode(&be);
        assert_eq!((text.as_str(), encoding), ("h€", Encoding::Utf16Be));
        assert_eq!(encode(&text, encoding).unwrap(), be);
        // Astral characters need surrogate pairs, which UTF-16 encodes and decodes.
        let (text, encoding) = decode(&encode("a😀b", Encoding::Utf16Le).unwrap());
        assert_eq!((text.as_str(), encoding), ("a😀b", Encoding::Utf16Le));
    }

    #[test]
    fn invalid_utf8_is_windows_1252_and_every_byte_survives_a_round_trip() {
        let latin1 = b"caf\xE9 \x80 \x93quoted\x94";
        let (text, encoding) = decode(latin1);
        assert_eq!(
            (text.as_str(), encoding),
            ("café € “quoted”", Encoding::Windows1252)
        );
        assert_eq!(encode(&text, encoding).unwrap(), latin1);

        let all: Vec<u8> = (0u8..=255).collect();
        let (text, encoding) = decode(&all);
        assert_eq!(encoding, Encoding::Windows1252);
        assert_eq!(text.chars().count(), 256);
        assert_eq!(encode(&text, encoding).unwrap(), all);
    }

    #[test]
    fn a_character_outside_windows_1252_is_refused_not_replaced() {
        let error = encode("naïve ✓", Encoding::Windows1252).unwrap_err();
        assert!(
            error.starts_with("“✓” (U+2713) cannot be written in Windows-1252"),
            "{error}"
        );
        assert_eq!(encode("naïve", Encoding::Windows1252).unwrap(), b"na\xEFve");
    }

    #[test]
    fn a_malformed_marked_file_still_opens_as_windows_1252() {
        let odd = [0xFF, 0xFE, b'h'];
        assert_eq!(decode(&odd).1, Encoding::Windows1252);
        let bad_bom = [0xEF, 0xBB, 0xBF, 0xC3];
        assert_eq!(decode(&bad_bom).1, Encoding::Windows1252);
        assert_eq!(
            encode(&decode(&bad_bom).0, Encoding::Windows1252).unwrap(),
            bad_bom
        );
    }
}
