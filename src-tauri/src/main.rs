// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mdwisp_lib::run()
}
