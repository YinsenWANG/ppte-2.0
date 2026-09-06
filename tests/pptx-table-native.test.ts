import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { makeContractDocument } from '../apps/contract-deck/index.js'
import { exportSemanticPptx, compileSemanticPptx, verifyNativeTableXml } from '../packages/exporter-pptx/src/index.js'
import { buildCapabilityReport } from '../packages/capability/src/index.js'
import { readStoredZip } from '../packages/archive/src/index.js'
import { migrateTableV1, tableProps } from '../packages/widgets/src/table-model.js'
import type { ComponentElement, TableModel } from '../packages/schema/src/index.js'
import { canonicalRevision } from '../packages/canonical-json/src/index.js'
import { readFileSync } from 'node:fs'

function fixture() {
  const { document } = makeContractDocument()
  const element: ComponentElement = { id: 'table', type: 'component', frame: { x: 0, y: -4, width: 600, height: 240 }, componentType: 'core/table', componentVersion: '1.0.0', props: { rows: [['中文 & <表>\n第二行', 0.125, 1234567890123], [true, null, '12345678901234567890'], ['合并锚', '保留值', 12.5]] }, fallback: { kind: 'placeholder', label: 'NOT A NATIVE TABLE' } }
  element.props = tableProps(migrateTableV1(element).model)
  element.componentVersion = '2.0.0'
  const slide = document.slides.slide_main
  document.slideOrder = ['slide_main']; document.slides = { slide_main: slide }
  slide.elements = { table: element }; slide.rootOrder = ['table']; delete slide.groups; delete slide.readingOrder; delete slide.protectedAnchors
  const model = element.props as unknown as TableModel
  return { document, element, model }
}
const text = (data: Uint8Array) => new TextDecoder().decode(data)
// Independent namespace-aware OOXML parser: tests do not use the exporter verifier as their oracle.
function inspect(bytes: Uint8Array): any {
  const result = spawnSync('python3', ['-c', `
import sys,io,zipfile,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
for n in z.namelist():
 if n.endswith('.xml') or n.endswith('.rels'): E.fromstring(z.read(n))
s=E.fromstring(z.read('ppt/slides/slide1.xml'))
f=s.find('.//p:graphicFrame',ns)
t=f.find('.//a:tbl',ns)
def cell(c):
 return {'attrs':c.attrib,'text':'\\n'.join(''.join(p.itertext()) for p in c.findall('a:txBody/a:p',ns)), 'fill':c.find('a:tcPr/a:solidFill/a:srgbClr',ns).get('val'), 'anchor':c.find('a:tcPr',ns).get('anchor'), 'runs':[r.attrib for r in c.findall('.//a:rPr',ns)], 'align':[p.get('algn') for p in c.findall('.//a:pPr',ns)]}
print(json.dumps({'widths':[int(c.get('w')) for c in t.findall('a:tblGrid/a:gridCol',ns)],'heights':[int(r.get('h')) for r in t.findall('a:tr',ns)],'rows':[[cell(c) for c in r.findall('a:tc',ns)] for r in t.findall('a:tr',ns)],'offset':f.find('p:xfrm/a:off',ns).attrib,'extent':f.find('p:xfrm/a:ext',ns).attrib,'pictures':len(s.findall('.//p:pic',ns)), 'textShapes':len(s.findall('.//p:sp',ns))}))
`], { input: bytes, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}

test('F03 A13 real editable DrawingML cells preserve typed display, Unicode and source values', () => {
  const { document, model } = fixture()
  model.cells['table:cell:0:1'].displayFormat = 'percent'
  model.cells['table:cell:2:2'].displayFormat = 'fixed:2'
  const before = canonicalRevision(document), result = exportSemanticPptx(document)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  const parsed = inspect(result.bytes)
  assert.equal(parsed.pictures, 0); assert.equal(parsed.textShapes, 0)
  assert.deepEqual(parsed.rows.map((r: any[]) => r.map(c=>c.text)), [['中文 & <表>\n第二行', '12.5%', '1234567890123'], ['true', '', '12345678901234567890'], ['合并锚', '保留值', '12.50']])
  assert.equal(canonicalRevision(document), before)
  const source = JSON.parse(text(readStoredZip(result.bytes).get('ppt/ppte/table-sources.json')!))
  assert.equal(source.sourceRevision, before); assert.deepEqual(source.tables['slide_main:table'], model)
  assert.equal(result.capabilityReport.items[0].nativeTable, true)
  assert.equal(result.capabilityReport.items[0].tableExport?.clientValidation, 'unverified')
})

test('F03 A13 rectangular merge topology, exact frame dimensions and basic cell styles', () => {
  const { document, model } = fixture()
  model.columns[model.columnOrder[0]].size = 240
  model.rows[model.rowOrder[0]].size = 64
  model.merges = [{ anchorCellId: 'table:cell:0:0', rowIds: model.rowOrder.slice(0,2), columnIds: model.columnOrder.slice(0,2) }]
  model.tableStyle = { color: '#123456', verticalAlign: 'top', fontSize: 20 }
  model.cells['table:cell:0:0'].style = { fill: '#ffeeaa', bold: true, italic: true, align: 'right' }
  const result = exportSemanticPptx(document), parsed = inspect(result.bytes)
  assert.equal(result.ok, true)
  assert.deepEqual(parsed.widths, [300,150,150].map(n=>n*9525))
  assert.deepEqual(parsed.heights, [120,60,60].map(n=>n*9525))
  assert.deepEqual(parsed.offset, { x:'0', y:String(-4*9525) })
  assert.deepEqual(parsed.extent, { cx:String(600*9525), cy:String(240*9525) })
  assert.deepEqual(parsed.rows[0][0].attrs, { gridSpan:'2', rowSpan:'2' })
  assert.deepEqual(parsed.rows[0][1].attrs, { rowSpan:'2', hMerge:'1' })
  assert.deepEqual(parsed.rows[1][0].attrs, { gridSpan:'2', vMerge:'1' })
  assert.deepEqual(parsed.rows[1][1].attrs, { hMerge:'1', vMerge:'1' })
  assert.equal(parsed.rows[1][0].text, ''); assert.equal(parsed.rows[0][0].fill, 'ffeeaa')
  assert.deepEqual(parsed.rows[0][0].runs, [{ sz:'1500', b:'1', i:'1' }, { sz:'1500', b:'1', i:'1' }])
  assert.deepEqual(parsed.rows[0][0].align, ['r','r']); assert.equal(parsed.rows[0][0].anchor, 't')
  const source = JSON.parse(text(readStoredZip(result.bytes).get('ppt/ppte/table-sources.json')!))
  assert.equal(source.tables['slide_main:table'].cells['table:cell:1:0'].value, true)
  assert.equal(result.capabilityReport.items[0].tableExport?.styles, 'native')
})

test('F03 A13 headers and caption survive; unsupported styles and rich text downgrade by property', () => {
  const { document, model } = fixture()
  model.columns[model.columnOrder[0]].label = '表头'
  model.caption = '说明 & 来源'
  model.tableStyle = { shadow: 'soft', fill: 'gradient' }
  model.cells['table:cell:2:0'].style = { border: { width: 5 }, align: 'justify' }
  model.cells['table:cell:2:0'].richText = { paragraphs:[{id:'p',runs:[{id:'r',text:'合并锚',marks:{bold:true}}]}] }
  const result = exportSemanticPptx(document), parsed = inspect(result.bytes)
  assert.equal(result.ok, true); assert.equal(result.degraded, true)
  assert.equal(parsed.rows[0][0].text, '说明 & 来源'); assert.equal(parsed.rows[0][0].attrs.gridSpan, '3')
  assert.equal(parsed.rows[1][0].text, '表头'); assert.equal(parsed.rows[4][0].text, '合并锚')
  const item = result.capabilityReport.items[0]
  assert.equal(item.nativeTable, true); assert.equal(item.status, 'layout-risk'); assert.equal(item.tableExport?.styles, 'degraded')
  for (const path of ['props.tableStyle.shadow','props.tableStyle.fill','props.cells.table:cell:2:0.style.border','props.cells.table:cell:2:0.style.align']) assert.ok(item.tableExport?.degradations.includes(path))
  assert.ok(item.tableExport?.degradations.some(p=>p.includes('richText')))
  assert.ok(result.issues.some(i=>i.code==='EXPORT_DEGRADED' && i.elementId==='table'))
})

test('F03 A17 nativeTable requires emitted validated output; forecasts, legacy, empty and hidden tables never claim it', () => {
  const { document, element, model } = fixture()
  for (const target of ['pptx-semantic','pptx-image','pdf','png','presenter','portable-light-edit'] as const) assert.equal(buildCapabilityReport(document,target).items[0].nativeTable, undefined)
  assert.equal(compileSemanticPptx(document).capabilityReport.items[0].nativeTable, undefined)
  element.visible = false
  assert.equal(exportSemanticPptx(document).capabilityReport.items[0].nativeTable, undefined)
  delete element.visible
  const result = exportSemanticPptx(document)
  assert.deepEqual(JSON.parse(text(readStoredZip(result.bytes).get('ppt/ppte/capability-report.json')!)), result.capabilityReport)
  assert.equal(result.capabilityReport.summary.native, 1); assert.equal(result.capabilityReport.summary.static, 0)
  const noReport = exportSemanticPptx(document, { includeCapabilityReport:false })
  assert.equal(noReport.capabilityReport.items[0].nativeTable, true); assert.equal(readStoredZip(noReport.bytes).has('ppt/ppte/capability-report.json'), false)
  assert.equal(exportSemanticPptx(document, { sourceRevision:'stale' }).capabilityReport.items[0].nativeTable, undefined)
  model.rowOrder=[]; model.rows={}; model.cells={}
  assert.equal(exportSemanticPptx(document).capabilityReport.items[0].nativeTable, undefined)
  element.componentVersion='1.0.0'; element.props={rows:[['legacy']]}
  assert.equal(exportSemanticPptx(document).capabilityReport.items[0].nativeTable, undefined)
})

test('F03 A17 verifier rejects label substitutions, missing cells, altered numbers, dimensions and merge flags', () => {
  const { document, element, model } = fixture()
  model.merges = [{anchorCellId:'table:cell:2:0',rowIds:[model.rowOrder[2]],columnIds:model.columnOrder.slice(0,2)}]
  const xml = text(readStoredZip(exportSemanticPptx(document).bytes).get('ppt/slides/slide1.xml')!)
  assert.equal(verifyNativeTableXml(xml,element), true)
  for (const changed of [xml.replace('<a:tbl>','<a:fake>'),xml.replace('1234567890123</a:t>','999</a:t>'),xml.replace(/<a:tc[^>]*>[\s\S]*?<\/a:tc>/,''),xml.replace('hMerge="1"','hMerge="0"'),xml.replace(/<a:gridCol w="\d+"/, '<a:gridCol w="1"'),xml.replace(/<a:tr h="\d+"/,'<a:tr h="1"'),xml.replace('<a:off x="0"','<a:off x="1"'),xml.replace('val="ffffff"','val="000000"'),xml.replace('sz="1350"','sz="2000"')]) assert.equal(verifyNativeTableXml(changed,element), false)
  assert.equal(verifyNativeTableXml('<p:sp><a:t>NOT A NATIVE TABLE</a:t></p:sp>',element), false)
})

test('F03 A17 capability schema registers adapter proof and explicit unverified clients', () => {
  const schema = JSON.parse(readFileSync('schemas/capability-report.schema.json','utf8'))
  const properties = schema.properties.items.items.properties
  assert.equal(properties.nativeTable.type,'boolean')
  assert.equal(properties.tableExport.properties.validation.const,'passed')
  assert.equal(properties.tableExport.properties.clientValidation.const,'unverified')
  assert.deepEqual(properties.tableExport.properties.styles.enum,['native','degraded'])
  const report=exportSemanticPptx(fixture().document).capabilityReport
  const result=spawnSync('python',['-c', `
import sys,json,copy
from jsonschema import Draft202012Validator
schema=json.load(open('schemas/capability-report.schema.json'))
v=Draft202012Validator(schema)
r=json.load(sys.stdin)
assert not list(v.iter_errors(r))
bad=copy.deepcopy(r); del bad['items'][0]['tableExport']; assert list(v.iter_errors(bad))
bad=copy.deepcopy(r); bad['target']='pptx-image'; assert list(v.iter_errors(bad))
bad=copy.deepcopy(r); bad['items'][0]['tableExport']['clientValidation']='passed'; assert list(v.iter_errors(bad))
`],{input:JSON.stringify(report)})
  assert.equal(result.status,0,result.stderr.toString())
})


test('F03 invalid tables and unrepresentable XML/dimensions fail without native proof', () => {
  for (const change of [
    (m: TableModel, e: ComponentElement) => { m.cells['table:cell:0:0'].value = 'invalid\u0001XML' },
    (m: TableModel, e: ComponentElement) => { e.frame.width = 0.00001 },
    (m: TableModel, e: ComponentElement) => { delete m.cells['table:cell:0:0'] },
  ]) {
    const { document, model, element } = fixture(); change(model, element)
    const result = exportSemanticPptx(document)
    assert.equal(result.ok, false); assert.equal(result.bytes.length, 0)
    assert.equal(result.capabilityReport.items[0].nativeTable, undefined)
    assert.ok(result.issues.some(i=>i.severity==='error'))
  }
})

test('F03 multiple tables and fractional axis weights preserve exact frame sums', () => {
  const { document, element } = fixture()
  element.frame.width = 601.125; element.frame.height = 241.375
  const second = structuredClone(element); second.id='second-table'
  document.slides.slide_main.elements[second.id]=second
  document.slides.slide_main.rootOrder.push(second.id)
  const result = exportSemanticPptx(document), parsed = inspect(result.bytes)
  assert.equal(result.ok,true)
  assert.equal(parsed.widths.reduce((a:number,b:number)=>a+b,0),Math.round(601.125*9525))
  assert.equal(parsed.heights.reduce((a:number,b:number)=>a+b,0),Math.round(241.375*9525))
  assert.equal(result.capabilityReport.items.filter(i=>i.nativeTable).length,2)
  const xml=text(readStoredZip(result.bytes).get('ppt/slides/slide1.xml')!)
  assert.equal(verifyNativeTableXml(xml,element),true);assert.equal(verifyNativeTableXml(xml,second),true)
})


test('F03 native adapter does not depend on fallback assets or widget policy claims', () => {
  const { document, element } = fixture()
  element.fallback = { kind:'asset', assetId:'asset_pixel', label:'legacy poster' }
  const result = exportSemanticPptx(document)
  assert.equal(result.ok,true,JSON.stringify(result.issues)); assert.equal(result.capabilityReport.items[0].nativeTable,true)
  element.fallback={kind:'asset',assetId:'missing'}
  const missing=exportSemanticPptx(document);assert.equal(missing.ok,false);assert.equal(missing.capabilityReport.items[0].nativeTable,undefined)
  element.componentType='custom/table'; element.props={exportPolicy:'native'}; element.fallback={kind:'placeholder',label:'table'}
  assert.equal(exportSemanticPptx(document).capabilityReport.items[0].nativeTable,undefined)
})
