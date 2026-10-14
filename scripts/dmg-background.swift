// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs
//
// Draws the disk image background: an arrow from where the bundler places
// mdwisp.app to where it places the Applications link, plus a hint line.
// The picture is transparent so it reads on both light and dark Finder
// windows. It is rendered at 2x and tagged 144 dpi so Finder shows it at
// the window's point size, crisp on Retina displays.
//
//   swift scripts/dmg-background.swift src-tauri/dmg/background.png
//
// Keep the geometry in step with bundle.macOS.dmg in tauri.conf.json:
// window 660x400, app at (180,170), Applications at (480,170), 128 pt icons.

import AppKit

let out = CommandLine.arguments.dropFirst().first ?? "background.png"
let width = 660.0, height = 400.0, scale = 2.0
let iconHalf = 64.0
let appX = 180.0, folderX = 480.0, iconY = 170.0
let grey = NSColor(calibratedWhite: 0.55, alpha: 1)

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
else { fatalError("could not allocate bitmap") }
rep.size = NSSize(width: width, height: height)

NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
// The context already maps points to the rep's pixels (rep.size is in
// points), so no extra scaling here.
// Flip so y grows downward, matching Finder's icon coordinates.
ctx.cgContext.translateBy(x: 0, y: height)
ctx.cgContext.scaleBy(x: 1, y: -1)

// Arrow shaft and head, centred between the two icons.
let gap = 36.0
let x0 = appX + iconHalf + gap, x1 = folderX - iconHalf - gap
let shaft = NSBezierPath()
shaft.lineWidth = 4
shaft.lineCapStyle = .round
shaft.lineJoinStyle = .round
shaft.move(to: NSPoint(x: x0, y: iconY))
shaft.line(to: NSPoint(x: x1 - 6, y: iconY))
let head = NSBezierPath()
head.lineWidth = 4
head.lineCapStyle = .round
head.lineJoinStyle = .round
head.move(to: NSPoint(x: x1 - 22, y: iconY - 16))
head.line(to: NSPoint(x: x1, y: iconY))
head.line(to: NSPoint(x: x1 - 22, y: iconY + 16))
grey.setStroke()
shaft.stroke()
head.stroke()

// Hint line under the icons. Text is drawn unflipped so glyphs are upright.
ctx.cgContext.saveGState()
ctx.cgContext.translateBy(x: 0, y: height)
ctx.cgContext.scaleBy(x: 1, y: -1)
let style = NSMutableParagraphStyle()
style.alignment = .center
let hint = NSAttributedString(
    string: "Drag mdwisp to the Applications folder to install it.",
    attributes: [
        .font: NSFont.systemFont(ofSize: 13),
        .foregroundColor: grey,
        .paragraphStyle: style,
    ])
let textTop = iconY + iconHalf + 58  // below the icon labels
hint.draw(in: NSRect(x: 0, y: height - textTop - 20, width: width, height: 20))
ctx.cgContext.restoreGState()

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("png encoding failed") }
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
