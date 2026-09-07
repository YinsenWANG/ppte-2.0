// Independent macOS CoreGraphics/PDFKit verification. CSS/SVG RGB is sampled in
// an explicit sRGB, 8-bit RGBA bitmap; never an NSImage display/thumbnail profile.
import Foundation
import PDFKit
import AppKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
var pages: [[String: Any]] = []
for i in 0..<doc.pageCount {
    let page = doc.page(at: i)!
    let bounds = page.bounds(for: .mediaBox)
    let width = 960, height = Int(ceil(960 * bounds.height / bounds.width))
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)!
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: CGFloat(width) / bounds.width, y: CGFloat(height) / bounds.height)
    context.translateBy(x: -bounds.minX, y: -bounds.minY)
    context.drawPDFPage(page.pageRef!)
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1] + ".page-" + String(i) + ".png"))
    let bytes = context.data!.assumingMemoryBound(to: UInt8.self)
    var red = 0, blue = 0
    for pixel in 0..<(width * height) {
        let r = Double(bytes[pixel * 4]) / 255, g = Double(bytes[pixel * 4 + 1]) / 255, b = Double(bytes[pixel * 4 + 2]) / 255
        if r > 0.9 && g < 0.1 && b < 0.1 { red += 1 }
        if b > 0.9 && g < 0.1 && r < 0.1 { blue += 1 }
    }
    pages.append(["text": page.string ?? "", "width": bounds.width, "height": bounds.height,
        "redPixels": red, "bluePixels": blue, "rasterWidth": width, "rasterHeight": height,
        "colorSpace": "sRGB", "rasterizer": "CGContext.drawPDFPage; RGBA8 big-endian; white background"])
}
print(String(data: try! JSONSerialization.data(withJSONObject: pages, options: .prettyPrinted), encoding: .utf8)!)
