// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

use std::time::{SystemTime, UNIX_EPOCH};

/// Civil date for a Unix timestamp, as "14 October 2026". Release builds
/// are made on the day the tag is pushed, so this is the release date the
/// About box shows; a dev build shows the day it was compiled. Honours
/// SOURCE_DATE_EPOCH so a reproducible build can pin it.
fn build_date() -> String {
    let secs = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        });
    // Days to civil date (Howard Hinnant's algorithm), proleptic Gregorian.
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    format!("{d} {} {y}", MONTHS[(m - 1) as usize])
}

fn main() {
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
    println!("cargo:rustc-env=MDWISP_BUILD_DATE={}", build_date());
    tauri_build::build()
}
