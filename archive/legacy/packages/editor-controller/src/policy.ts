import type { Transaction, ValidationIssue, PpteDocument } from '../../schema/src/index.js'
export type EditorProfile = 'host' | 'viewer' | 'quick-fix' | 'light-edit' | 'full-portable'
const quick = new Set(['text.replaceContent', 'asset.upsert', 'image.replaceAsset', 'fact.upsert', 'fact.syncReferences', 'table.setCellValue', 'table.setCellStyle'])
const light = new Set([...quick, 'image.setCrop', 'chart.replaceData', 'element.move', 'element.resize', 'element.rotate'])
export function commandPolicy(profile: EditorProfile, mutable: boolean, transaction?: Transaction, document?: Readonly<PpteDocument>): ValidationIssue[] {
  const issue = (code: string, message: string): ValidationIssue[] => [{ code, message, severity: 'error' }]
  if (!mutable) return issue('PRESENTATION_READONLY', 'Exit presentation before editing.')
  if (profile === 'viewer') return issue('PORTABLE_EDIT_UNSUPPORTED', 'Viewer profile does not allow edits.')
  if (profile !== 'host' && transaction?.operations.some(op=>op.kind.startsWith('table.')&&!['table.setCellValue','table.setCellStyle'].includes(op.kind))) return issue('PORTABLE_EDIT_UNSUPPORTED','Table structure editing requires Host.')
  if (profile !== 'host' && transaction?.operations.some(op => {
    if (op.kind !== 'component.updateProps') return false
    const target = document?.slides[op.slideId]?.elements[op.elementId]
    return target?.type === 'component' && target.componentType === 'core/table'
  })) return issue('PORTABLE_EDIT_UNSUPPORTED', 'Use typed cell edits for Portable tables.')
  const allowed = profile === 'quick-fix' ? quick : profile === 'light-edit' ? light : undefined
  if (allowed && transaction?.operations.some(op => !allowed.has(op.kind))) return issue('PORTABLE_EDIT_UNSUPPORTED', 'This profile does not support every operation in the command.')
  return []
}
