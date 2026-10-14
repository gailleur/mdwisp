// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! App Sandbox support for the Mac App Store build.
//!
//! Inside the sandbox the app can read only what the user hands it: a file
//! chosen in a dialog, dropped on the window, or opened from Finder. The
//! folder around a document stays invisible, so images beside it do not
//! load. When the user grants a folder through the open-folder dialog, a
//! security-scoped bookmark remembers that grant across launches. Outside
//! the sandbox (direct downloads, Linux, Windows) everything here is a
//! no-op that reports folders as readable.

use std::path::Path;

/// True when running inside the macOS App Sandbox.
pub fn active() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Re-opens every folder the user granted in earlier sessions.
pub fn restore(store: &Path) {
    #[cfg(target_os = "macos")]
    mac::restore(store);
    #[cfg(not(target_os = "macos"))]
    let _ = store;
}

/// Keeps access to `dir`, which the user just chose in a folder dialog, and
/// records it in `store` for the next launch.
pub fn remember(store: &Path, dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        mac::remember(store, dir)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (store, dir);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_foundation::{
        NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
    };
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::Mutex;

    /// URLs whose security scope is open. Access lasts until the process
    /// exits; the app never needs to close it earlier.
    static HELD: Mutex<Vec<Retained<NSURL>>> = Mutex::new(Vec::new());

    type Store = BTreeMap<String, String>;

    fn load(store: &Path) -> Store {
        std::fs::read(store)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(store: &Path, map: &Store) -> Result<(), String> {
        if let Some(parent) = store.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_vec(map).map_err(|e| e.to_string())?;
        std::fs::write(store, json).map_err(|e| e.to_string())
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn unhex(text: &str) -> Option<Vec<u8>> {
        if text.len() % 2 != 0 {
            return None;
        }
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
            .collect()
    }

    fn hold(url: Retained<NSURL>) -> bool {
        // SAFETY: plain AppKit call on a file URL we own.
        let ok = unsafe { url.startAccessingSecurityScopedResource() };
        if ok {
            if let Ok(mut held) = HELD.lock() {
                held.push(url);
            }
        }
        ok
    }

    pub fn restore(store: &Path) {
        if !super::active() {
            return;
        }
        let map = load(store);
        let mut kept = Store::new();
        for (dir, encoded) in &map {
            let Some(bytes) = unhex(encoded) else { continue };
            let data = NSData::with_bytes(&bytes);
            let mut stale = Bool::NO;
            // SAFETY: `stale` is a valid pointer for the duration of the call.
            let resolved = unsafe {
                NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                    &data,
                    NSURLBookmarkResolutionOptions::WithSecurityScope,
                    None,
                    &mut stale,
                )
            };
            let Ok(url) = resolved else { continue };
            if stale.as_bool() {
                // Re-create the bookmark while the scope is still valid.
                if hold(url.clone()) {
                    if let Ok(fresh) = make_bookmark(&url) {
                        kept.insert(dir.clone(), hex(fresh.to_vec().as_slice()));
                    }
                }
                continue;
            }
            if hold(url) {
                kept.insert(dir.clone(), encoded.clone());
            }
        }
        if kept != map {
            let _ = save(store, &kept);
        }
    }

    fn make_bookmark(url: &NSURL) -> Result<Retained<NSData>, String> {
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| e.localizedDescription().to_string())
    }

    pub fn remember(store: &Path, dir: &Path) -> Result<(), String> {
        if !super::active() {
            return Ok(());
        }
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&dir.to_string_lossy()), true);
        let data = make_bookmark(&url)?;
        if !hold(url) {
            return Err("The system refused access to that folder.".into());
        }
        let mut map = load(store);
        map.insert(dir.to_string_lossy().into_owned(), hex(data.to_vec().as_slice()));
        save(store, &map)
    }
}
