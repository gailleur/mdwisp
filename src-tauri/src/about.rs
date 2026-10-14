// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! What the About box says, and on macOS how it is shown. AppKit's standard
//! panel accepts a rich-text credits block, so "Gailleur Labs" and "Check
//! for Updates…" can be real links there; the menu library only forwards
//! plain text, which is why the macOS panel is raised by hand. Links open
//! through the system: the website in the browser, and the update link as
//! a `mdwisp://` URL that macOS hands straight back to the running app
//! (registered in Info.plist, handled in lib.rs). The panel itself makes
//! no request.

pub struct About {
    pub name: &'static str,
    /// Day the build was made, which for a tagged release is the release
    /// date. Set by build.rs. The version itself comes from the running
    /// app's package info, the same value the update check compares.
    pub released: &'static str,
    pub copyright: &'static str,
    pub publisher: &'static str,
    pub homepage: &'static str,
}

/// The update line in the credits: its label and the URL it opens.
pub struct UpdateLink {
    pub label: &'static str,
    pub url: &'static str,
}

/// URL the About box's "Check for Updates…" link opens; lib.rs turns it
/// into the same action as the Help menu item.
pub const CHECK_URL: &str = "mdwisp://check-updates";

#[cfg(target_os = "macos")]
pub fn show(about: &About, version: &str, update: &UpdateLink) {
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationName, NSAboutPanelOptionApplicationVersion,
        NSAboutPanelOptionCredits, NSAboutPanelOptionVersion, NSApplication, NSImage, NSLinkAttributeName,
        NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSTextAlignment,
    };
    use objc2_foundation::{
        ns_string, NSAttributedString, NSData, NSDictionary, NSMutableAttributedString, NSString, NSURL,
    };

    /// The bundle supplies the icon in a packaged app; passing it explicitly
    /// makes dev builds, which have no bundle, show the same mark.
    const ICON_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(icon) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(ICON_PNG)) else {
        return;
    };

    // SAFETY: the dictionaries are built with the key and value types the
    // AppKit APIs document, on the main thread.
    unsafe {
        let centered = NSMutableParagraphStyle::new();
        centered.setAlignment(NSTextAlignment::Center);
        let style: &AnyObject = &centered;
        let link = |text: &str, url: &str| -> Option<objc2::rc::Retained<NSAttributedString>> {
            let url = NSURL::URLWithString(&NSString::from_str(url))?;
            let target: &AnyObject = &url;
            let attrs = NSDictionary::from_slices::<NSString>(
                &[NSLinkAttributeName, NSParagraphStyleAttributeName],
                &[target, style],
            );
            Some(NSAttributedString::initWithString_attributes(
                NSAttributedString::alloc(),
                &NSString::from_str(text),
                Some(&attrs),
            ))
        };
        let plain = |text: &str| {
            let attrs = NSDictionary::from_slices::<NSString>(&[NSParagraphStyleAttributeName], &[style]);
            NSAttributedString::initWithString_attributes(NSAttributedString::alloc(), &NSString::from_str(text), Some(&attrs))
        };

        let (Some(update_link), Some(publisher)) = (link(update.label, update.url), link(about.publisher, about.homepage))
        else {
            return;
        };
        let credits = NSMutableAttributedString::new();
        credits.appendAttributedString(&plain(&format!("Released {}\n", about.released)));
        credits.appendAttributedString(&update_link);
        credits.appendAttributedString(&plain("\n\n"));
        credits.appendAttributedString(&publisher);

        let name = NSString::from_str(about.name);
        let version = NSString::from_str(version);
        // The bundle's build number equals the version; an empty build
        // string stops AppKit printing it again in parentheses.
        let build = NSString::new();
        let copyright = NSString::from_str(about.copyright);
        let values: [&AnyObject; 6] = [&icon, &name, &version, &build, &copyright, &credits];
        let options = NSDictionary::from_slices::<NSString>(
            &[
                NSAboutPanelOptionApplicationIcon,
                NSAboutPanelOptionApplicationName,
                NSAboutPanelOptionApplicationVersion,
                NSAboutPanelOptionVersion,
                // AppKit reads this undocumented key for the copyright line;
                // the public header has no constant for it.
                ns_string!("Copyright"),
                NSAboutPanelOptionCredits,
            ],
            &values,
        );
        NSApplication::sharedApplication(mtm).orderFrontStandardAboutPanelWithOptions(&options);
    }
}
