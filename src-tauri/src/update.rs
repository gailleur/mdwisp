// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! Checking for a newer release, and installing it, only when the user asks.
//!
//! This is the one place the app reaches the network of its own accord, and
//! it never does so unprompted: nothing here runs at launch or on a timer.
//! The check fetches one fixed URL (`plugins.updater.endpoints` in
//! `tauri.conf.json`); the URL carries no version, platform or identifier,
//! so the request says no more about the user than opening a web page would.
//! Comparison with the running version happens locally. A download is
//! accepted only if it carries a valid signature from the project's key.
//!
//! The Mac App Store copy never updates itself (Apple forbids it, and the
//! sandbox could not replace the bundle anyway): there the same actions
//! point at the store page.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// mdwisp's page in the Mac App Store, opened by the store build's
/// "Check for Updates". An https URL so the opener plugin's default scope
/// covers it; macOS hands it to the App Store app.
pub const STORE_URL: &str = "https://apps.apple.com/app/id6822752985";

/// The update found by the last check, kept so "install" needs no second
/// request.
#[derive(Default)]
pub struct Found(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Check {
    /// The Mac App Store copy: updates come through the store.
    Store { url: String },
    UpToDate { version: String },
    Available {
        version: String,
        /// Release date as the manifest states it, ISO 8601.
        date: Option<String>,
        notes: Option<String>,
    },
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Fetches the release manifest and compares it with the running version.
#[tauri::command]
pub async fn check_update<R: Runtime>(app: AppHandle<R>, found: State<'_, Found>) -> Result<Check, String> {
    if crate::sandbox::active() {
        return Ok(Check::Store { url: STORE_URL.into() });
    }
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let current = app.package_info().version.to_string();
    match updater.check().await.map_err(|e| e.to_string())? {
        None => {
            if let Ok(mut slot) = found.0.lock() {
                *slot = None;
            }
            Ok(Check::UpToDate { version: current })
        }
        Some(update) => {
            let check = Check::Available {
                version: update.version.clone(),
                date: update
                    .date
                    .and_then(|d| d.format(&time::format_description::well_known::Rfc3339).ok()),
                notes: update.body.clone(),
            };
            if let Ok(mut slot) = found.0.lock() {
                *slot = Some(update);
            }
            Ok(check)
        }
    }
}

/// Downloads the update found by `check_update`, verifies its signature,
/// installs it and relaunches. Progress goes out as `update-progress`
/// events. On Windows the installer takes over and this process exits.
#[tauri::command]
pub async fn install_update<R: Runtime>(app: AppHandle<R>, found: State<'_, Found>) -> Result<(), String> {
    let update = found
        .0
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .ok_or_else(|| "Check for updates first.".to_string())?;

    let reporter = app.clone();
    let mut downloaded = 0u64;
    let mut last_percent = u64::MAX;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let percent = total.map(|t| downloaded * 100 / t.max(1)).unwrap_or(0);
                if percent != last_percent {
                    last_percent = percent;
                    let _ = reporter.emit("update-progress", Progress { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
