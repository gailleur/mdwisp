// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! Native shell for mdwisp.
//!
//! The shell does four things: it builds the native menu, it hands files
//! from the OS (double-click, drag onto the icon, command line, second
//! launch) to the webview, it reads documents on the webview's behalf while
//! granting read access only to each document's directory, and it opens the
//! system print dialog. It never touches the network.

mod pdf;

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedDocument {
    path: String,
    name: String,
    dir: String,
}

/// Writes a document atomically (temp file + rename) so a crash mid-write
/// never leaves a truncated file, then grants access to its directory as
/// `open_document` does. Only Markdown extensions may be written.
#[tauri::command]
fn save_document<R: Runtime>(app: AppHandle<R>, path: String, text: String) -> Result<SavedDocument, String> {
    let requested = PathBuf::from(&path);
    if !looks_like_markdown(&requested) {
        return Err("Only Markdown files can be saved.".into());
    }
    let name = requested
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "Missing file name.".to_string())?;
    let dir = requested
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(std::fs::canonicalize)
        .unwrap_or_else(|| std::env::current_dir())
        .map_err(|e| e.to_string())?;
    let target = dir.join(&name);

    let temp = dir.join(format!(".{name}.mdwisp-{}.tmp", std::process::id()));
    std::fs::write(&temp, text.as_bytes()).map_err(|e| e.to_string())?;
    if let Err(error) = std::fs::rename(&temp, &target) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }

    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;

    Ok(SavedDocument {
        path: target.to_string_lossy().into_owned(),
        name,
        dir: dir.to_string_lossy().into_owned(),
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

/// Writes the current page as a PDF at `path` using the platform webview's
/// own print-to-file path. Only `.pdf` targets are accepted.
#[tauri::command]
async fn export_pdf<R: Runtime>(window: tauri::WebviewWindow<R>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let is_pdf = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err("Only .pdf files can be written.".into());
    }
    pdf::export(window, path).await
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let new_doc = MenuItemBuilder::with_id("new", "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save-as", "Save As…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let autosave = MenuItemBuilder::with_id("autosave", "Toggle Autosave").build(app)?;
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let print = MenuItemBuilder::with_id("print", "Print…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let export_pdf = MenuItemBuilder::with_id("export-pdf", "Export PDF…")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let mut file = SubmenuBuilder::new(app, "File")
        .item(&new_doc)
        .item(&open)
        .separator()
        .item(&save)
        .item(&save_as)
        .item(&autosave)
        .item(&reload)
        .separator()
        .item(&print)
        .item(&export_pdf)
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

    // Format: block types and inline marks. Ids are "fmt-<kind>" and the
    // frontend applies them to whichever editor is active.
    let fmt = |id: &str, label: &str, accel: Option<&str>| -> tauri::Result<tauri::menu::MenuItem<R>> {
        let b = MenuItemBuilder::with_id(format!("fmt-{id}"), label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let format = SubmenuBuilder::new(app, "Format")
        .item(&fmt("paragraph", "Paragraph", Some("CmdOrCtrl+Alt+0"))?)
        .item(&fmt("h1", "Heading 1", Some("CmdOrCtrl+Alt+1"))?)
        .item(&fmt("h2", "Heading 2", Some("CmdOrCtrl+Alt+2"))?)
        .item(&fmt("h3", "Heading 3", Some("CmdOrCtrl+Alt+3"))?)
        .item(&fmt("h4", "Heading 4", Some("CmdOrCtrl+Alt+4"))?)
        .item(&fmt("h5", "Heading 5", Some("CmdOrCtrl+Alt+5"))?)
        .item(&fmt("h6", "Heading 6", Some("CmdOrCtrl+Alt+6"))?)
        .separator()
        .item(&fmt("bold", "Bold", Some("CmdOrCtrl+B"))?)
        .item(&fmt("italic", "Italic", Some("CmdOrCtrl+I"))?)
        .item(&fmt("strike", "Strikethrough", Some("CmdOrCtrl+Shift+X"))?)
        .item(&fmt("code", "Inline Code", Some("CmdOrCtrl+E"))?)
        .item(&fmt("link", "Link…", Some("CmdOrCtrl+K"))?)
        .separator()
        .item(&fmt("bullet", "Bulleted List", Some("CmdOrCtrl+Shift+7"))?)
        .item(&fmt("ordered", "Numbered List", Some("CmdOrCtrl+Shift+9"))?)
        .item(&fmt("task", "Task List", Some("CmdOrCtrl+Shift+L"))?)
        .item(&fmt("quote", "Quote", Some("CmdOrCtrl+Shift+."))?)
        .item(&fmt("codeblock", "Code Block", Some("CmdOrCtrl+Shift+C"))?)
        .separator()
        .item(&fmt("hr", "Horizontal Rule", None)?)
        .item(&fmt("table", "Table", None)?)
        .build()?;

    let outline = MenuItemBuilder::with_id("outline", "Outline")
        .accelerator("CmdOrCtrl+Alt+S")
        .build(app)?;
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
    let mode_view = MenuItemBuilder::with_id("mode-view", "Reading")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let mode_wysiwyg = MenuItemBuilder::with_id("mode-wysiwyg", "Editor")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let mode_source = MenuItemBuilder::with_id("mode-source", "Source")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&mode_view)
        .item(&mode_wysiwyg)
        .item(&mode_source)
        .separator()
        .item(&outline)
        .item(&theme)
        .item(&remote_images)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .build()?;

    // Help: an in-app, offline panel. No links to the web and no "check for
    // updates"; the About box is the platform's own.
    let about = AboutMetadataBuilder::new()
        .name(Some("mdwisp"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .copyright(Some("© 2026 Gailleur Labs"))
        .license(Some("Apache-2.0"))
        .build();
    let help_item = MenuItemBuilder::with_id("help", "mdwisp Help")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let help = SubmenuBuilder::new(app, "Help").item(&help_item);
    #[cfg(not(target_os = "macos"))]
    let help = help.separator().about(Some(about.clone()));
    let help = help.build()?;

    let mut menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
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

    let menu = menu.items(&[&file, &edit, &format, &view, &help]).build()?;
    app.set_menu(menu)?;
    #[cfg(target_os = "macos")]
    help.set_as_help_menu_for_nsapp()?;
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
            save_document,
            take_pending_files,
            print_page,
            export_pdf
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
