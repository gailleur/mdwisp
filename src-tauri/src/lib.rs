// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! Native shell for mdwisp.
//!
//! The shell does four things: it builds the native menu, it hands files
//! from the OS (double-click, drag onto the icon, command line, second
//! launch) to the webview, it reads documents on the webview's behalf while
//! granting read access only to each document's directory, and it opens the
//! system print dialog. It touches the network in exactly one case: when
//! the user asks it to check for a new version (update.rs).

mod about;
mod defaults;
mod pdf;
mod sandbox;
mod update;

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

#[cfg(not(target_os = "macos"))]
use tauri::menu::AboutMetadataBuilder;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_fs::FsExt;

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// What the About box shows, on every platform.
const ABOUT: about::About = about::About {
    name: "mdwisp",
    released: env!("MDWISP_BUILD_DATE"),
    copyright: "© 2026 Gailleur Labs",
    publisher: "Gailleur Labs",
    homepage: "https://gailleur.com",
};

/// The About box's update line: the Mac App Store copy points at the
/// store, every other build at the in-app check.
fn update_link() -> about::UpdateLink {
    if sandbox::active() {
        about::UpdateLink { label: "View in the App Store", url: update::STORE_URL }
    } else {
        about::UpdateLink { label: "Check for Updates…", url: about::CHECK_URL }
    }
}

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
    /// True inside the App Sandbox, where a document grants access to
    /// itself only and images beside it may fail to load.
    sandboxed: bool,
}

/// Where granted folders are remembered (App Sandbox only).
fn folder_store<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("folders.json"))
        .map_err(|e| e.to_string())
}

/// Keeps access to a folder the user just chose, so images beside the
/// documents in it load, now and on later launches. The folder dialog is
/// the only way in: the app cannot grant itself anything.
#[tauri::command]
fn remember_folder<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let dir = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err("Not a folder.".into());
    }
    sandbox::remember(&folder_store(&app)?, &dir)?;
    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    Ok(())
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
        sandboxed: sandbox::active(),
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

    // Inside the App Sandbox a save grants access to the chosen file only,
    // so the temp file beside it cannot be created; write in place then.
    let temp = dir.join(format!(".{name}.mdwisp-{}.tmp", std::process::id()));
    match std::fs::write(&temp, text.as_bytes()) {
        Ok(()) => {
            if let Err(error) = std::fs::rename(&temp, &target) {
                let _ = std::fs::remove_file(&temp);
                return Err(error.to_string());
            }
        }
        Err(_) if sandbox::active() => {
            std::fs::write(&target, text.as_bytes()).map_err(|e| e.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
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

/// Asks what to do with unsaved changes before a tab or the window closes.
/// Three buttons, as the platform's own editors offer: Save, Discard,
/// Cancel. Returns "save", "discard" or "cancel"; closing the dialog
/// counts as cancel. The dialog plugin's JavaScript API stops at two
/// buttons, hence this command.
#[tauri::command]
async fn confirm_close<R: Runtime>(window: tauri::WebviewWindow<R>, name: String) -> Result<String, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
    let (tx, rx) = mpsc::channel::<MessageDialogResult>();
    window
        .dialog()
        .message(format!("“{name}” has unsaved changes. Save them before closing?"))
        .title("Unsaved changes")
        .kind(MessageDialogKind::Warning)
        .parent(&window)
        .buttons(MessageDialogButtons::YesNoCancelCustom("Save".into(), "Discard".into(), "Cancel".into()))
        .show_with_result(move |result| {
            let _ = tx.send(result);
        });
    let result = tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())??;
    Ok(match result {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(label) if label == "Save" => "save",
        MessageDialogResult::Custom(label) if label == "Discard" => "discard",
        _ => "cancel",
    }
    .to_string())
}

/// Sets the check mark on a toggle menu item. The frontend holds the real
/// state (it persists across launches) and calls this at startup and on
/// every change, so the menu never disagrees with the status bar.
#[tauri::command]
fn set_menu_checked<R: Runtime>(app: AppHandle<R>, id: String, checked: bool) -> Result<(), String> {
    use tauri::menu::{CheckMenuItem, MenuItemKind};
    // `Menu::get` looks only at the top level; the toggles live in submenus.
    fn find<R: Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<CheckMenuItem<R>> {
        items.into_iter().find_map(|item| match item {
            MenuItemKind::Check(check) if check.id() == id => Some(check),
            MenuItemKind::Submenu(sub) => sub.items().ok().and_then(|inner| find(inner, id)),
            _ => None,
        })
    }
    let menu = app.menu().ok_or("No menu.")?;
    let item = find(menu.items().map_err(|e| e.to_string())?, &id).ok_or_else(|| format!("No toggle menu item {id}."))?;
    item.set_checked(checked).map_err(|e| e.to_string())
}

/// Opens the system print dialog. The webview's own `window.print()` is used
/// on platforms where the native call is not available. macOS goes through
/// pdf.rs so the page gets real margins; the library call sets none.
#[tauri::command]
async fn print_page<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        pdf::print(window).await.map(|_| true)
    }
    #[cfg(target_os = "windows")]
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

/// `Some(true)` when mdwisp already opens Markdown files, `None` where the
/// platform offers no way to read that.
#[tauri::command]
fn default_app_status<R: Runtime>(app: AppHandle<R>) -> Option<bool> {
    defaults::is_default(&app.config().identifier)
}

/// Makes mdwisp the default Markdown app, or opens the system page where
/// the user can. Only ever called from an explicit user action. macOS
/// answers through a consent dialog, so the result arrives over a channel.
#[tauri::command]
async fn make_default_app<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let bundle_id = app.config().identifier.clone();
    let (tx, rx) = mpsc::channel::<defaults::Reply>();
    app.run_on_main_thread(move || defaults::make_default(&bundle_id, tx))
        .map_err(|e| e.to_string())?;
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(600))
            .map_err(|_| "The system did not answer.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(outcome.message().to_string())
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
    // Toggles are check items; the frontend owns the state and mirrors it
    // into the check mark through `set_menu_checked`.
    let autosave = CheckMenuItemBuilder::with_id("autosave", "Autosave").checked(false).build(app)?;
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
    // Checked while mdwisp is the system's default for .md; the frontend
    // reads that from the platform and mirrors it here.
    let default_app = CheckMenuItemBuilder::with_id("default-app", "Use mdwisp for .md Files")
        .checked(false)
        .build(app)?;

    let mut file = SubmenuBuilder::new(app, "File")
        .item(&new_doc)
        .item(&open)
        .item(&default_app)
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

    let outline = CheckMenuItemBuilder::with_id("outline", "Outline Sidebar")
        .accelerator("CmdOrCtrl+Alt+S")
        .checked(false)
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
    let remote_images = CheckMenuItemBuilder::with_id("remote-images", "Remote Images")
        .checked(false)
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

    // Help: an in-app, offline panel, and the one network action the app
    // offers, checking for a new version, which runs only when chosen. The
    // About box is the platform's own, with "Gailleur Labs" linking to the
    // website. On macOS the panel is raised by about.rs so the links can be
    // rich text; elsewhere the menu library's About item handles it.
    let help_item = MenuItemBuilder::with_id("help", "mdwisp Help")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let check_updates = MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&help_item)
        .separator()
        .item(&check_updates);
    #[cfg(not(target_os = "macos"))]
    let help = {
        let about = AboutMetadataBuilder::new()
            .name(Some(ABOUT.name))
            .version(Some(app.package_info().version.to_string()))
            .comments(Some(format!("Released {}", ABOUT.released)))
            .copyright(Some(ABOUT.copyright))
            .license(Some("Apache-2.0"))
            .website(Some(ABOUT.homepage))
            .website_label(Some(ABOUT.publisher))
            .build();
        help.separator().about(Some(about))
    };
    let help = help.build()?;

    let mut menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let about_item = MenuItemBuilder::with_id("about", "About mdwisp").build(app)?;
        let app_menu = SubmenuBuilder::new(app, "mdwisp")
            .item(&about_item)
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
        // Registered but dormant: it makes a request only inside the two
        // commands in update.rs, which run on a menu choice and nothing else.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingFiles::default())
        .manage(update::Found::default())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            take_pending_files,
            confirm_close,
            set_menu_checked,
            print_page,
            export_pdf,
            default_app_status,
            make_default_app,
            remember_folder,
            update::check_update,
            update::install_update
        ])
        .setup(|app| {
            build_menu(app.handle())?;
            if let Ok(store) = folder_store(app.handle()) {
                sandbox::restore(&store);
            }
            queue_files(app.handle(), paths_from_args(std::env::args()));
            Ok(())
        })
        .on_menu_event(|app, event| {
            #[cfg(target_os = "macos")]
            if event.id().0 == "about" {
                let version = app.package_info().version.to_string();
                let _ = app.run_on_main_thread(move || about::show(&ABOUT, &version, &update_link()));
                return;
            }
            let _ = app.emit("menu", event.id().0.clone());
        })
        .build(tauri::generate_context!())
        .expect("failed to build mdwisp")
        .run(|app, event| {
            // macOS delivers files opened via Finder as an event rather than
            // command-line arguments. The About box's update link arrives
            // the same way, as the app's own URL scheme.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                if urls.iter().any(|u| u.as_str() == about::CHECK_URL) {
                    let _ = app.emit("menu", "check-updates");
                }
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
