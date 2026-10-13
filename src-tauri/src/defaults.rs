// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! Becoming the default application for Markdown files. The installers
//! register the association; which app is the default stays the user's
//! choice on every platform, so this is only ever done when they ask.
//!
//! - macOS: NSWorkspace sets the handler and the system asks the user to
//!   confirm (macOS 12 and later); macOS 11 takes Launch Services directly.
//! - Linux: the user's `mimeapps.list` names the desktop file.
//! - Windows: only the Settings app can change a default, so it is opened.
//!
//! Results come back over a channel because macOS answers asynchronously.

use std::sync::mpsc::Sender;

pub enum Outcome {
    /// The default is set.
    Done,
    /// The platform's settings page is open; the user finishes there.
    #[cfg_attr(not(windows), allow(dead_code))]
    OpenedSettings,
}

impl Outcome {
    pub fn message(&self) -> &'static str {
        match self {
            Outcome::Done => "mdwisp now opens Markdown files.",
            Outcome::OpenedSettings => "Choose mdwisp for .md in the Default apps page that just opened.",
        }
    }
}

pub type Reply = Result<Outcome, String>;

/// Whether mdwisp is already the default, or `None` where that cannot be
/// read without a shell.
pub fn is_default(bundle_id: &str) -> Option<bool> {
    platform::is_default(bundle_id)
}

/// Sends exactly one reply on `tx`. Call on the main thread.
pub fn make_default(bundle_id: &str, tx: Sender<Reply>) {
    platform::make_default(bundle_id, tx)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{Outcome, Reply};
    use std::sync::mpsc::Sender;

    use block2::RcBlock;
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use objc2::sel;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSError, NSObjectProtocol, NSString};
    use objc2_uniform_type_identifiers::UTType;

    /// `.md` and `.markdown` share the system's Markdown type; the rarer
    /// extensions get dynamic types and are left alone.
    const EXTENSION: &str = "md";

    type OSStatus = i32;
    type LSRolesMask = u32;
    const ROLES_ALL: LSRolesMask = 0xFFFF_FFFF;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: LSRolesMask,
            handler_bundle_id: CFStringRef,
        ) -> OSStatus;
        fn LSCopyDefaultRoleHandlerForContentType(content_type: CFStringRef, role: LSRolesMask) -> CFStringRef;
    }

    fn markdown_type() -> Option<objc2::rc::Retained<UTType>> {
        UTType::typeWithFilenameExtension(&NSString::from_str(EXTENSION))
    }

    pub fn is_default(bundle_id: &str) -> Option<bool> {
        let uti = CFString::new(&markdown_type()?.identifier().to_string());
        // SAFETY: a plain Launch Services read; the returned reference is
        // ours to release (copy rule).
        unsafe {
            let current = LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), ROLES_ALL);
            if current.is_null() {
                return Some(false);
            }
            let current = CFString::wrap_under_create_rule(current);
            Some(current.to_string().eq_ignore_ascii_case(bundle_id))
        }
    }

    pub fn make_default(bundle_id: &str, tx: Sender<Reply>) {
        let reply = start(bundle_id, tx.clone());
        if let Err(err) = reply {
            let _ = tx.send(Err(err));
        }
    }

    fn start(bundle_id: &str, tx: Sender<Reply>) -> Result<(), String> {
        let uti = markdown_type().ok_or("macOS has no type for .md files.")?;
        let workspace = NSWorkspace::sharedWorkspace();

        // Launch Services only accepts an app that is installed, so a dev
        // binary sets the default to the installed copy, if any.
        let app_url = workspace
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))
            .ok_or("mdwisp is not installed as an application; copy it to Applications first.")?;

        let modern = workspace.respondsToSelector(sel!(setDefaultApplicationAtURL:toOpenContentType:completionHandler:));
        if !modern {
            // macOS 11: no consent dialog, Launch Services takes it directly.
            let uti = CFString::new(&uti.identifier().to_string());
            let handler = CFString::new(bundle_id);
            // SAFETY: plain Launch Services call with owned CFStrings.
            let status = unsafe {
                LSSetDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), ROLES_ALL, handler.as_concrete_TypeRef())
            };
            return if status == 0 {
                tx.send(Ok(Outcome::Done)).map_err(|e| e.to_string())
            } else {
                Err(format!("Launch Services refused the change (error {status})."))
            };
        }

        let done = RcBlock::new(move |error: *mut NSError| {
            let reply: Reply = if error.is_null() {
                Ok(Outcome::Done)
            } else {
                // SAFETY: AppKit hands a live NSError for the callback's duration.
                let description = unsafe { &*error }.localizedDescription().to_string();
                Err(description)
            };
            let _ = tx.send(reply);
        });
        workspace.setDefaultApplicationAtURL_toOpenContentType_completionHandler(&app_url, &uti, Some(&done));
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{Outcome, Reply};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::mpsc::Sender;

    const DESKTOP_FILE: &str = "mdwisp.desktop";
    const MIME: &str = "text/markdown";
    const SECTION: &str = "[Default Applications]";

    fn config_dir() -> Option<PathBuf> {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    }

    /// The desktop file only exists for the .deb and .rpm installs; an
    /// AppImage is not registered with the desktop and cannot be a default.
    fn installed() -> bool {
        let mut dirs: Vec<PathBuf> = std::env::var_os("XDG_DATA_DIRS")
            .map(|v| std::env::split_paths(&v).collect())
            .unwrap_or_else(|| vec![PathBuf::from("/usr/local/share"), PathBuf::from("/usr/share")]);
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".local/share"));
        }
        dirs.iter().any(|d| d.join("applications").join(DESKTOP_FILE).is_file())
    }

    pub fn is_default(_bundle_id: &str) -> Option<bool> {
        let text = fs::read_to_string(config_dir()?.join("mimeapps.list")).ok()?;
        let mut in_defaults = false;
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                in_defaults = line == SECTION;
            } else if in_defaults {
                if let Some(value) = line.strip_prefix(MIME).and_then(|r| r.trim_start().strip_prefix('=')) {
                    return Some(value.split(';').next().map(str::trim) == Some(DESKTOP_FILE));
                }
            }
        }
        Some(false)
    }

    pub fn make_default(bundle_id: &str, tx: Sender<Reply>) {
        let _ = tx.send(apply(bundle_id));
    }

    /// Every Markdown extension is covered by the one MIME type the desktop
    /// file declares.
    fn apply(_bundle_id: &str) -> Reply {
        if !installed() {
            return Err("This build is not registered with the desktop (AppImage). Install the .deb or .rpm to make mdwisp the default.".into());
        }
        let dir = config_dir().ok_or("No config directory (HOME is unset).")?;
        let path = dir.join("mimeapps.list");
        let existing = fs::read_to_string(&path).unwrap_or_default();

        // Rewrite the one key inside [Default Applications], keeping every
        // other line as it was.
        let entry = format!("{MIME}={DESKTOP_FILE}");
        let mut out: Vec<String> = Vec::new();
        let mut in_defaults = false;
        let mut written = false;
        let mut seen_section = false;
        for line in existing.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                if in_defaults && !written {
                    out.push(entry.clone());
                    written = true;
                }
                in_defaults = trimmed == SECTION;
                seen_section |= in_defaults;
            } else if in_defaults && trimmed.strip_prefix(MIME).map_or(false, |r| r.trim_start().starts_with('=')) {
                if !written {
                    out.push(entry.clone());
                    written = true;
                }
                continue;
            }
            out.push(line.to_string());
        }
        if !written {
            if !seen_section {
                if out.last().map_or(false, |l| !l.is_empty()) {
                    out.push(String::new());
                }
                out.push(SECTION.to_string());
            }
            out.push(entry);
        }

        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(&path, out.join("\n") + "\n").map_err(|e| e.to_string())?;
        Ok(Outcome::Done)
    }
}

#[cfg(windows)]
mod platform {
    use super::{Outcome, Reply};
    use std::sync::mpsc::Sender;

    pub fn is_default(_bundle_id: &str) -> Option<bool> {
        None
    }

    /// Windows 10 and later let only the Settings app change a default,
    /// so open it on the Default apps page. The installer has already
    /// registered mdwisp for every Markdown extension.
    pub fn make_default(_bundle_id: &str, tx: Sender<Reply>) {
        let reply = tauri_plugin_opener::open_url("ms-settings:defaultapps", None::<&str>)
            .map(|_| Outcome::OpenedSettings)
            .map_err(|e| e.to_string());
        let _ = tx.send(reply);
    }
}
