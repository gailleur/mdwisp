// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

//! Native shell for mdwisp.
//!
//! The shell does four things: it builds the native menu, it hands files
//! from the OS (double-click, drag onto the icon, command line, second
//! launch) to the webview, it reads documents on the webview's behalf while
//! granting read access only to each document's directory, and it opens the
//! system print dialog. It never touches the network.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_fs::FsExt;

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// Files the OS asked us to open before the webview was ready to receive
/// events. Drained once by the frontend at startup.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    name: String,
    dir: String,
    text: String,
}

fn looks_like_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Command-line arguments that name existing files. Flags and unreadable
/// paths are ignored; the frontend decides what to do with non-Markdown files.
fn paths_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn queue_files<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(pending) = app.try_state::<PendingFiles>() {
        if let Ok(mut list) = pending.0.lock() {
            list.extend(paths.iter().cloned());
        }
    }
    let _ = app.emit("open-files", &paths);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

/// Reads a document and grants the webview read access to its directory so
/// relative images resolve and the file can be watched. Access is never
/// granted outside directories of documents the user chose to open.
#[tauri::command]
fn open_document<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Document, String> {
    let path = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("Not a file.".into());
    }
    if !looks_like_markdown(&path) {
        return Err("Not a Markdown file.".into());
    }

    let dir = path
        .parent()
        .ok_or_else(|| "Document has no parent directory.".to_string())?
        .to_path_buf();

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes).into_owned();

    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;

    Ok(Document {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        dir: dir.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        text,
    })
}

#[tauri::command]
fn take_pending_files(pending: State<'_, PendingFiles>) -> Vec<String> {
    pending.0.lock().map(|mut l| std::mem::take(&mut *l)).unwrap_or_default()
}

/// Opens the system print dialog. The webview's own `window.print()` is used
/// on platforms where the native call is not available.
#[tauri::command]
fn print_page<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<bool, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        window.print().map(|_| true).map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Ok(false)
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let print = MenuItemBuilder::with_id("print", "Print…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let mut file = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&reload)
        .separator()
        .item(&print)
        .separator()
        .item(&close_tab);
    if !cfg!(target_os = "macos") {
        file = file.separator().quit();
    }
    let file = file.build()?;

    let find = MenuItemBuilder::with_id("find", "Find…")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let find_next = MenuItemBuilder::with_id("find-next", "Find Next")
        .accelerator("CmdOrCtrl+G")
        .build(app)?;
    let find_prev = MenuItemBuilder::with_id("find-prev", "Find Previous")
        .accelerator("CmdOrCtrl+Shift+G")
        .build(app)?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .item(&find_next)
        .item(&find_prev)
        .build()?;

    let theme = MenuItemBuilder::with_id("theme", "Cycle Theme")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom-in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let remote_images = MenuItemBuilder::with_id("remote-images", "Toggle Remote Images")
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&theme)
        .item(&remote_images)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .build()?;

    let mut menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let about = AboutMetadataBuilder::new()
            .name(Some("mdwisp"))
            .version(Some(env!("CARGO_PKG_VERSION")))
            .copyright(Some("© 2026 Gailleur"))
            .build();
        let app_menu = SubmenuBuilder::new(app, "mdwisp")
            .about(Some(about))
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu = menu.item(&app_menu);
    }

    let menu = menu.items(&[&file, &edit, &view]).build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default();

    // A second launch (file association on Linux/Windows) hands its arguments
    // to the running instance instead of opening another window.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        queue_files(app, paths_from_args(args));
    }));

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PendingFiles::default())
        .invoke_handler(tauri::generate_handler![
            open_document,
            take_pending_files,
            print_page
        ])
        .setup(|app| {
            build_menu(app.handle())?;
            queue_files(app.handle(), paths_from_args(std::env::args()));
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        })
        .build(tauri::generate_context!())
        .expect("failed to build mdwisp")
        .run(|app, event| {
            // macOS delivers files opened via Finder as an event rather than
            // command-line arguments.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                queue_files(app, paths);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}
