# Raster difference is diagnostic only. No threshold is used to qualify a PDF.
import json, fitz, sys
from PIL import Image, ImageChops
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else 'docs/usability-reset/evidence/U04')
pics=[];words=[]
for name in ['original-fixtures-04-chromium.pdf','original-fixtures-04-chromium-viewport1440-scale150.pdf','fixtures-04/fixed.pdf']:
    doc=fitz.open(root/name);page=doc[0]
    pix=page.get_pixmap(matrix=fitz.Matrix(4/3,4/3),alpha=False)
    pics.append(Image.frombytes('RGB',[pix.width,pix.height],pix.samples));words.append(page.get_text('words'))
diff=ImageChops.difference(pics[0],pics[1]);pixels=list(diff.getdata())
screen=Image.open(root/'fixtures-04/screen.png').convert('RGB')
sheet=Image.new('RGB',(640*4,800),'white')
for i,pic in enumerate([screen,*pics]):sheet.paste(pic,(640*i,0))
sheet.save(root/'transform-comparison.png')
rows=json.load(open(root/'rows.json'))
json.dump({'oldVariantChangedPixelsAbove32':sum(max(p)>32 for p in pixels),'oldVariantMaximumChannelDelta':max(max(p) for p in pixels),'oldVariantDifferenceBounds':diff.getbbox(),'oldVariantWordGeometryExact':words[0]==words[1],'oldVariantMaximumWordCoordinateDeltaPt':max(abs(x[i]-y[i]) for x,y in zip(words[0],words[1]) for i in range(4)),'panels':['fixed author screen','original PDF','original viewport variant','fixed PDF'],'fixedVariantsEqual':all(x['pdfkitRasterEqual'] and x['mupdfRasterEqual'] and x['domGeometryEqual'] for x in rows)},open(root/'transform-summary.json','w'),indent=2)
