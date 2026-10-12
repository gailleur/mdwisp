// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mdwisp_lib::run()
}
