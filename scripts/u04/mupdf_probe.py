# Existing local PyMuPDF is an independent parser/rasterizer, not a product dependency.
import fitz, json, sys, hashlib
from PIL import Image, ImageChops
path=sys.argv[1]
doc=fitz.open(path)
rows=[]
for p in doc:
    pix=p.get_pixmap(matrix=fitz.Matrix(4/3,4/3), alpha=False)
    text=p.get_text()
    rows.append(dict(text=text, sortedText=p.get_text(sort=True), size=[p.rect.width,p.rect.height], search={q:[list(r) for r in p.search_for(q)] for q in ['English 2026','甲乙丙丁','三维变换','变换后的中文 Text']}, words=p.get_text('words'), rasterSHA256=hashlib.sha256(pix.samples).hexdigest()))
print(json.dumps(dict(version=fitz.VersionBind,pages=rows),ensure_ascii=False))
