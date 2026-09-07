import Foundation
import PDFKit
import AppKit
for path in CommandLine.arguments.dropFirst() {
 let d=PDFDocument(url:URL(fileURLWithPath:path))!
 let p=d.page(at:0)!, thumb=p.thumbnail(of:NSSize(width:960,height:540),for:.mediaBox)
 let b=NSBitmapImageRep(data:thumb.tiffRepresentation!)!
 var raw=0,srgb=0,hist:[String:Int]=[:]
 for y in 0..<b.pixelsHigh {for x in 0..<b.pixelsWide {
  let c=b.colorAt(x:x,y:y)!,s=c.usingColorSpace(.sRGB)!
  if c.redComponent > 0.9 && c.greenComponent < 0.1 && c.blueComponent < 0.1 {raw += 1}
  if s.redComponent > 0.9 && s.greenComponent < 0.1 && s.blueComponent < 0.1 {srgb += 1}
  if c.redComponent > 0.7 && c.blueComponent < 0.4 {let key=String(format:"%.3f %.3f %.3f -> %.3f %.3f %.3f",c.redComponent,c.greenComponent,c.blueComponent,s.redComponent,s.greenComponent,s.blueComponent);hist[key,default:0] += 1}
 }}
 print(path,b.colorSpaceName.rawValue,b.pixelsWide,b.pixelsHigh,"raw",raw,"srgb",srgb,hist.sorted{$0.value>$1.value}.prefix(4))
}
