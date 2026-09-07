import Foundation
import PDFKit
import AppKit
let args=CommandLine.arguments
if args[1] == "merge" {
 let target=PDFDocument(); var index=0
 for path in args.dropFirst(3) {let d=PDFDocument(url:URL(fileURLWithPath:path))!; for i in 0..<d.pageCount {target.insert(d.page(at:i)!,at:index);index += 1}}
 guard target.write(to:URL(fileURLWithPath:args[2])) else {fatalError("PDF merge failed")}
 exit(0)
}
func fontInfo(_ d: CGPDFDictionaryRef) -> [String:Any] {
 var name:UnsafePointer<CChar>?;var subtype:UnsafePointer<CChar>?
 CGPDFDictionaryGetName(d,"BaseFont",&name);CGPDFDictionaryGetName(d,"Subtype",&subtype)
 var result:[String:Any] = ["baseFont":name.map{String(cString:$0)} ?? "unknown","subtype":subtype.map{String(cString:$0)} ?? "unknown"]
 var descriptor:CGPDFDictionaryRef?;var embedded:[String]=[]
 if CGPDFDictionaryGetDictionary(d,"FontDescriptor",&descriptor),let desc=descriptor {
  for key in ["FontFile","FontFile2","FontFile3"] {var stream:CGPDFStreamRef?;if CGPDFDictionaryGetStream(desc,key,&stream){embedded.append(key)}}
 }
 result["embeddedStreams"]=embedded
 var charProcs:CGPDFDictionaryRef?;result["type3CharProcsPresent"]=CGPDFDictionaryGetDictionary(d,"CharProcs",&charProcs)
 var unicode:CGPDFStreamRef?;result["toUnicodePresent"]=CGPDFDictionaryGetStream(d,"ToUnicode",&unicode)
 var descendants:CGPDFArrayRef?
 if CGPDFDictionaryGetArray(d,"DescendantFonts",&descendants),let ds=descendants {
  var child:CGPDFDictionaryRef?;if CGPDFArrayGetDictionary(ds,0,&child),let c=child{result["descendant"]=fontInfo(c)}
 }
 return result
}
func pageFonts(_ page:PDFPage)->[[String:Any]] {
 var resources:CGPDFDictionaryRef?,fonts:CGPDFDictionaryRef?;var result:[[String:Any]]=[]
 if let d=page.pageRef?.dictionary,CGPDFDictionaryGetDictionary(d,"Resources",&resources),let r=resources,CGPDFDictionaryGetDictionary(r,"Font",&fonts),let f=fonts {
  withUnsafeMutablePointer(to:&result){ptr in CGPDFDictionaryApplyFunction(f,{key,obj,context in
   var dict:CGPDFDictionaryRef?;if CGPDFObjectGetValue(obj,.dictionary,&dict),let d=dict,let ctx=context {var info=fontInfo(d);info["resource"]=String(cString:key);ctx.assumingMemoryBound(to:[[String:Any]].self).pointee.append(info)}
  },ptr)}
 }
 return result
}
let path=args[1], doc=PDFDocument(url:URL(fileURLWithPath:path))!
var pages:[[String:Any]]=[]
for i in 0..<doc.pageCount {
 let page=doc.page(at:i)!, bounds=page.bounds(for:.mediaBox)
 let width=Int(round(bounds.width/0.75)),height=Int(round(bounds.height/0.75))
 let c=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
 c.setFillColor(CGColor(red:1,green:1,blue:1,alpha:1));c.fill(CGRect(x:0,y:0,width:width,height:height))
 c.scaleBy(x:CGFloat(width)/bounds.width,y:CGFloat(height)/bounds.height);c.drawPDFPage(page.pageRef!)
 let bitmap=NSBitmapImageRep(cgImage:c.makeImage()!)
 try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:path+".page-\(i).png"))
 let bytes=c.data!.assumingMemoryBound(to:UInt8.self);var red=0,blue=0
 for px in 0..<(width*height) {let r=bytes[px*4],g=bytes[px*4+1],b=bytes[px*4+2];if r>229 && g<26 && b<26 {red += 1};if b>229 && g<26 && r<26 {blue += 1}}
 var chars:[[String:Any]]=[]
 for j in 0..<page.numberOfCharacters {let b=page.characterBounds(at:j);chars.append(["index":j,"text":page.selection(for:NSRange(location:j,length:1))?.string ?? "","boundsPDFBottomLeft":[b.minX,b.minY,b.width,b.height]])}
 var diff:Any=NSNull()
 if args.count>2 && i==0, let ref=NSImage(contentsOfFile:args[2]),let tiff=ref.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),rep.pixelsWide==width && rep.pixelsHigh==height {
  // Compare explicit sRGB rasters. This is diagnostic, never an aesthetic pass threshold.
  let r=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
  r.draw(rep.cgImage!,in:CGRect(x:0,y:0,width:width,height:height));let rb=r.data!.assumingMemoryBound(to:UInt8.self)
  var total:Double=0;var changed=0
  for px in 0..<(width*height){var delta=0;for ch in 0..<3{let d=abs(Int(bytes[px*4+ch])-Int(rb[px*4+ch]));total += Double(d);delta=max(delta,d)};if delta>32{changed += 1}}
  diff=["meanAbsoluteChannelDifference":total/Double(width*height*3),"fractionPixelsDeltaAbove32":Double(changed)/Double(width*height),"automaticPassThreshold":NSNull()]
 }
 pages.append(["page":i+1,"text":page.string ?? "","widthPt":bounds.width,"heightPt":bounds.height,"rasterWidth":width,"rasterHeight":height,"redPixels":red,"bluePixels":blue,"characters":chars,"fonts":pageFonts(page),"search":Dictionary(uniqueKeysWithValues:["English 2026","甲乙丙丁","统计结论","Grid","SVG 文字","三维变换"].map { query in (query,doc.findString(query,withOptions:[]).filter{$0.pages.contains(page)}.map{["text":$0.string ?? "","bounds":NSStringFromRect($0.bounds(for:page))]})}),"screenDifference":diff])
}
print(String(data:try JSONSerialization.data(withJSONObject:pages,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
