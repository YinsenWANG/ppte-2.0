import Foundation
import PDFKit
import AppKit
let document=PDFDocument(url:URL(fileURLWithPath:CommandLine.arguments[1]))!
let p=document.page(at:0)!
let image=p.thumbnail(of:NSSize(width:960,height:540),for:.mediaBox)
let b=NSBitmapImageRep(data:image.tiffRepresentation!)!
var rawRed=0,rawBlue=0,sRed=0,sBlue=0
for y in 0..<b.pixelsHigh { for x in 0..<b.pixelsWide {
 let c=b.colorAt(x:x,y:y)!,s=c.usingColorSpace(.sRGB)!
 if c.redComponent>0.9 && c.greenComponent<0.1 && c.blueComponent<0.1 {rawRed+=1}
 if c.blueComponent>0.9 && c.greenComponent<0.1 && c.redComponent<0.1 {rawBlue+=1}
 if s.redComponent>0.9 && s.greenComponent<0.1 && s.blueComponent<0.1 {sRed+=1}
 if s.blueComponent>0.9 && s.greenComponent<0.1 && s.redComponent<0.1 {sBlue+=1}
}}
let c=b.colorAt(x:50,y:220)!,s=c.usingColorSpace(.sRGB)!
let r:[String:Any]=["space":c.colorSpace.localizedName ?? "unknown","rawRedPixels":rawRed,"rawBluePixels":rawBlue,"sRGBRedPixels":sRed,"sRGBBluePixels":sBlue,"sampleRaw":[c.redComponent,c.greenComponent,c.blueComponent],"sampleSRGB":[s.redComponent,s.greenComponent,s.blueComponent]]
print(String(data:try! JSONSerialization.data(withJSONObject:r,options:.prettyPrinted),encoding:.utf8)!)
