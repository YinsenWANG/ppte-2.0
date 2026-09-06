from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
fb=FontBuilder(1000,isTTF=True)
chars=list(range(32,127)); names=['.notdef']+[f'u{c}' for c in chars]
fb.setupGlyphOrder(names); fb.setupCharacterMap({c:f'u{c}' for c in chars})
glyphs={}
for name in names:
 p=TTGlyphPen(None)
 if name!='u32':
  p.moveTo((80,0));p.lineTo((480,0));p.lineTo((480,700));p.lineTo((80,700));p.closePath()
 glyphs[name]=p.glyph()
fb.setupGlyf(glyphs);fb.setupHorizontalMetrics({n:(600,0) for n in names});fb.setupHorizontalHeader(ascent=800,descent=-200)
fb.setupNameTable({'familyName':'D03 Fixture','styleName':'Regular','uniqueFontIdentifier':'D03Fixture1','fullName':'D03 Fixture','psName':'D03Fixture'})
fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200)
fb.setupPost();fb.setupMaxp();fb.save('tests/fixtures/design-system/d03-fixture.ttf')
