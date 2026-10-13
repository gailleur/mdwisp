// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! What the About box says, and on macOS how it is shown. AppKit's standard
//! panel accepts a rich-text credits block, so "Gailleur Labs" can be a real
//! link there; the menu library only forwards plain text, which is why the
//! macOS panel is raised by hand. The link opens in the system browser when
//! clicked. The app itself still makes no request.

pub struct About {
    pub name: &'static str,
    pub version: &'static str,
    pub copyright: &'static str,
    pub publisher: &'static str,
    pub homepage: &'static str,
}

#[cfg(target_os = "macos")]
pub fn show(about: &About) {
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationName, NSAboutPanelOptionApplicationVersion,
        NSAboutPanelOptionCredits, NSApplication, NSImage, NSLinkAttributeName,
    };
    use objc2_foundation::{ns_string, NSAttributedString, NSData, NSDictionary, NSString, NSURL};

    /// The bundle supplies the icon in a packaged app; passing it explicitly
    /// makes dev builds, which have no bundle, show the same mark.
    const ICON_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(url) = NSURL::URLWithString(&NSString::from_str(about.homepage)) else {
        return;
    };
    let Some(icon) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(ICON_PNG)) else {
        return;
    };

    // SAFETY: the dictionaries are built with the key and value types the
    // AppKit APIs document, on the main thread.
    unsafe {
        let link: &AnyObject = &url;
        let link_attrs = NSDictionary::from_slices::<NSString>(&[NSLinkAttributeName], &[link]);
        let credits = NSAttributedString::initWithString_attributes(
            NSAttributedString::alloc(),
            &NSString::from_str(about.publisher),
            Some(&link_attrs),
        );

        let name = NSString::from_str(about.name);
        let version = NSString::from_str(about.version);
        let copyright = NSString::from_str(about.copyright);
        let values: [&AnyObject; 5] = [&icon, &name, &version, &copyright, &credits];
        let options = NSDictionary::from_slices::<NSString>(
            &[
                NSAboutPanelOptionApplicationIcon,
                NSAboutPanelOptionApplicationName,
                NSAboutPanelOptionApplicationVersion,
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
