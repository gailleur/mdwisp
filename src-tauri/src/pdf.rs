// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! Direct PDF export. Every system webview can print to a file without a
//! dialog; this module drives that path. The page is laid out with the
//! same print stylesheet the Print command uses, so the two outputs match.
//! On macOS the Print command itself lives here too: the webview library's
//! own print call hands AppKit zero margins, so Print builds the same page
//! setup as the export and shows the panel instead of saving.
//!
//! Each platform hands its result back over a channel because WebView2 and
//! WebKitGTK finish asynchronously on the main thread, while the command
//! itself runs on the async runtime and waits.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use tauri::{Runtime, WebviewWindow};

pub type Outcome = Result<(), String>;

pub async fn export<R: Runtime>(window: WebviewWindow<R>, path: PathBuf) -> Outcome {
    let (tx, rx) = mpsc::channel::<Outcome>();
    window
        .with_webview(move |webview| platform::export(webview, path, tx))
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "PDF export did not finish.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the system print panel with the same margins as the PDF export.
#[cfg(target_os = "macos")]
pub async fn print<R: Runtime>(window: WebviewWindow<R>) -> Outcome {
    let (tx, rx) = mpsc::channel::<Outcome>();
    window
        .with_webview(move |webview| {
            let _ = tx.send(platform::print(webview));
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Print did not start.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
mod platform {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass};
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob};
    use objc2_foundation::{NSCopying, NSObject, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;

    const MARGIN_POINTS: f64 = 36.0; // half an inch

    struct Ivars {
        tx: Sender<super::Outcome>,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and PrintDelegate
        // does not implement Drop.
        #[unsafe(super(NSObject))]
        #[name = "MdwispPrintDelegate"]
        #[ivars = Ivars]
        struct PrintDelegate;

        impl PrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _operation: &NSPrintOperation, success: bool, _context: *mut c_void) {
                let outcome = if success { Ok(()) } else { Err("PDF export did not complete.".to_string()) };
                let _ = self.ivars().tx.send(outcome);
            }
        }
    );

    impl PrintDelegate {
        fn new(tx: Sender<super::Outcome>) -> Retained<Self> {
            let this = Self::alloc().set_ivars(Ivars { tx });
            // SAFETY: plain NSObject init.
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        /// NSPrintOperation does not retain its delegate; keep the last few
        /// alive here. Exports finish long before four more are started.
        static DELEGATES: RefCell<Vec<Retained<PrintDelegate>>> = const { RefCell::new(Vec::new()) };
    }

    pub fn export(webview: PlatformWebview, path: PathBuf, tx: Sender<super::Outcome>) {
        if let Err(err) = start(webview, &path, tx.clone()) {
            let _ = tx.send(Err(err));
        }
    }

    /// A private copy of the shared print setup with half-inch margins.
    /// Copying matters: other code paths mutate the shared object.
    unsafe fn page_setup() -> Retained<NSPrintInfo> {
        let info = NSPrintInfo::sharedPrintInfo().copy();
        info.setLeftMargin(MARGIN_POINTS);
        info.setRightMargin(MARGIN_POINTS);
        info.setTopMargin(MARGIN_POINTS);
        info.setBottomMargin(MARGIN_POINTS);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        info
    }

    /// The Print command: same page setup as the export, panel shown.
    pub fn print(webview: PlatformWebview) -> Result<(), String> {
        // SAFETY: as in `start`; the panel runs window-modal and AppKit
        // owns the operation from here on.
        unsafe {
            let view: &WKWebView = &*(webview.inner() as *const WKWebView);
            let window = view.window().ok_or("The document window is gone.")?;
            let op = view.printOperationWithPrintInfo(&page_setup());
            op.setShowsPrintPanel(true);
            op.setShowsProgressPanel(true);
            op.setCanSpawnSeparateThread(true);
            op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &window,
                None,
                None,
                std::ptr::null_mut(),
            );
            Ok(())
        }
    }

    fn start(webview: PlatformWebview, path: &Path, tx: Sender<super::Outcome>) -> Result<(), String> {
        let path = path.to_str().ok_or("Path is not valid UTF-8.")?;
        // SAFETY: Tauri invokes this closure on the main thread with a live
        // WKWebView pointer. WebKit paginates on a secondary printing thread
        // and needs the main run loop free, so the operation runs as a
        // window-modal session (the same path as Print) with the panel
        // hidden, and reports back through the delegate.
        unsafe {
            let view: &WKWebView = &*(webview.inner() as *const WKWebView);
            let window = view.window().ok_or("The document window is gone.")?;

            let info = page_setup();
            info.setJobDisposition(NSPrintSaveJob);
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            info.dictionary()
                .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));

            let op = view.printOperationWithPrintInfo(&info);
            op.setShowsPrintPanel(false);
            op.setShowsProgressPanel(false);
            op.setCanSpawnSeparateThread(true);

            let delegate = PrintDelegate::new(tx);
            DELEGATES.with(|kept| {
                let mut kept = kept.borrow_mut();
                if kept.len() >= 4 {
                    kept.remove(0);
                }
                kept.push(delegate.clone());
            });
            let delegate_object: &AnyObject = &delegate;
            op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &window,
                Some(delegate_object),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
            Ok(())
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::Sender;

    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING, PCWSTR};

    const MARGIN_INCHES: f64 = 0.5;

    pub fn export(webview: PlatformWebview, path: PathBuf, tx: Sender<super::Outcome>) {
        if let Err(err) = start(webview, &path, tx.clone()) {
            let _ = tx.send(Err(err));
        }
    }

    fn start(webview: PlatformWebview, path: &Path, tx: Sender<super::Outcome>) -> Result<(), String> {
        let e = |err: windows_core::Error| err.to_string();
        // SAFETY: COM calls on the WebView2 objects Tauri owns, made on the
        // main thread inside `with_webview`. The completion handler keeps
        // the sender alive until WebView2 reports back.
        unsafe {
            let core = webview.controller().CoreWebView2().map_err(e)?;
            let core: ICoreWebView2_7 = core
                .cast()
                .map_err(|_| "This WebView2 runtime is too old to export PDF.".to_string())?;
            let env: ICoreWebView2Environment6 = webview
                .environment()
                .cast()
                .map_err(|_| "This WebView2 runtime is too old to export PDF.".to_string())?;

            let settings = env.CreatePrintSettings().map_err(e)?;
            settings.SetShouldPrintBackgrounds(true).map_err(e)?;
            settings.SetMarginTop(MARGIN_INCHES).map_err(e)?;
            settings.SetMarginBottom(MARGIN_INCHES).map_err(e)?;
            settings.SetMarginLeft(MARGIN_INCHES).map_err(e)?;
            settings.SetMarginRight(MARGIN_INCHES).map_err(e)?;

            let file = HSTRING::from(path.as_os_str());
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, written| {
                let outcome = match result {
                    Ok(()) if written => Ok(()),
                    Ok(()) => Err("WebView2 could not write the PDF.".to_string()),
                    Err(err) => Err(err.to_string()),
                };
                let _ = tx.send(outcome);
                Ok(())
            }));
            core.PrintToPdf(PCWSTR(file.as_ptr()), &settings, &handler).map_err(e)
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::sync::mpsc::Sender;

    use gtk::prelude::*;
    use tauri::webview::PlatformWebview;
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    thread_local! {
        /// Operations still printing; WebKit does not hold its own reference.
        static IN_FLIGHT: RefCell<Vec<PrintOperation>> = const { RefCell::new(Vec::new()) };
    }

    fn release(op: &PrintOperation) {
        IN_FLIGHT.with(|list| list.borrow_mut().retain(|o| o != op));
    }

    pub fn export(webview: PlatformWebview, path: PathBuf, tx: Sender<super::Outcome>) {
        let uri = match gtk::glib::filename_to_uri(&path, None) {
            Ok(uri) => uri,
            Err(err) => {
                let _ = tx.send(Err(err.to_string()));
                return;
            }
        };

        let settings = gtk::PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set("output-file-format", Some("pdf"));
        settings.set("output-uri", Some(uri.as_str()));

        let op = PrintOperation::new(&webview.inner());
        op.set_print_settings(&settings);
        let finished = tx.clone();
        op.connect_finished(move |op| {
            release(op);
            let _ = finished.send(Ok(()));
        });
        op.connect_failed(move |op, err| {
            release(op);
            let _ = tx.send(Err(err.to_string()));
        });
        IN_FLIGHT.with(|list| list.borrow_mut().push(op.clone()));
        op.print();
    }
}
