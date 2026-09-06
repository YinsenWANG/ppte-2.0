// Independent macOS PDFKit verification of the S07 browser-emitted PDF.
import Foundation
import PDFKit
import AppKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
var pages: [[String: Any]] = []
for i in 0..<doc.pageCount {
    let page = doc.page(at: i)!
    let bounds = page.bounds(for: .mediaBox)
    let thumbnail = page.thumbnail(of: NSSize(width: 960, height: 540), for: .mediaBox)
    let bitmap = NSBitmapImageRep(data: thumbnail.tiffRepresentation!)!
    try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1] + ".page-" + String(i) + ".png"))
    var red = 0, blue = 0
    for y in 0..<bitmap.pixelsHigh {
        for x in 0..<bitmap.pixelsWide {
            let c = bitmap.colorAt(x: x, y: y)!
            if c.redComponent > 0.9 && c.greenComponent < 0.1 && c.blueComponent < 0.1 { red += 1 }
            if c.blueComponent > 0.9 && c.greenComponent < 0.1 && c.redComponent < 0.1 { blue += 1 }
        }
    }
    pages.append(["text": page.string ?? "", "width": bounds.width, "height": bounds.height, "redPixels": red, "bluePixels": blue])
}
print(String(data: try! JSONSerialization.data(withJSONObject: pages, options: .prettyPrinted), encoding: .utf8)!)
