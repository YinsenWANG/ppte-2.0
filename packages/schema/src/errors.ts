/**
 * Cross-boundary error semantics. A host can use these fields to decide
 * whether to retry, preserve the last checkpoint, or ask for manual recovery.
 */
export type ErrorImpact = 'document' | 'transaction' | 'content' | 'resource' | 'persistence' | 'security' | 'compatibility' | 'export' | 'runtime'
export type ContentSafety = 'safe' | 'at-risk' | 'unknown'
export type Recoverability = 'none' | 'retry' | 'journal' | 'manual' | 'readonly'

export interface ErrorSemantics {
  impact: ErrorImpact
  contentSafety: ContentSafety
  canSave: boolean
  recoverability: Recoverability
  retryable: boolean
}

export interface PpteError extends ErrorSemantics {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  recovery: string
  slideId?: string
  elementId?: string
  semanticKey?: string
  factId?: string
  path?: string
  causeId?: string
}

export interface ErrorDescriptor extends ErrorSemantics {
  recovery: string
}

const safeUnchanged: ErrorDescriptor = { impact: 'transaction', contentSafety: 'safe', canSave: false, recoverability: 'manual', retryable: false, recovery: 'Keep the last valid snapshot and correct the reported input before retrying.' }
const retryPersistence: ErrorDescriptor = { impact: 'persistence', contentSafety: 'safe', canSave: false, recoverability: 'retry', retryable: true, recovery: 'Keep the last valid checkpoint, retry the operation, and inspect the recovery journal if present.' }
const journalPersistence: ErrorDescriptor = { impact: 'persistence', contentSafety: 'safe', canSave: false, recoverability: 'journal', retryable: true, recovery: 'Keep the last valid checkpoint and recover only the validated journal tail.' }
const unsafeResource: ErrorDescriptor = { impact: 'resource', contentSafety: 'at-risk', canSave: false, recoverability: 'manual', retryable: false, recovery: 'Remove or replace the invalid resource, then validate again.' }
const readonlyPackage: ErrorDescriptor = { impact: 'compatibility', contentSafety: 'safe', canSave: false, recoverability: 'readonly', retryable: false, recovery: 'Open read-only or run the forward migration into a new package.' }

/** Appendix-D codes plus boundary codes emitted by the reference runtime. */
export const ERROR_CATALOG: Readonly<Record<string, ErrorDescriptor>> = Object.freeze({
  SCHEMA_INVALID: { ...safeUnchanged, impact: 'document' },
  SCHEMA_VERSION_UNSUPPORTED: { ...readonlyPackage },
  COMPATIBILITY_PROFILE_UNSUPPORTED: { ...readonlyPackage },
  COMPATIBILITY_PROFILE_MISMATCH: { ...readonlyPackage },
  COMPATIBILITY_PROFILE_MIGRATION_REQUIRED: { ...readonlyPackage, recoverability: 'manual', recovery: 'Run the forward migration into a new package and review its report before saving.' },
  REVISION_CONFLICT: { ...safeUnchanged, impact: 'transaction', recovery: 'Reload the current snapshot, rebase the transaction, and preview it again.' },
  SCOPE_VIOLATION: { ...safeUnchanged, recovery: 'Reduce the transaction to the granted Scope and preview it again.' },
  CHANGE_KIND_NOT_ALLOWED: { ...safeUnchanged },
  CHANGE_PATH_NOT_ALLOWED: { ...safeUnchanged },
  MUTATION_BUDGET_EXCEEDED: { ...safeUnchanged },
  CHANGE_INVARIANT_VIOLATION: { ...safeUnchanged },
  EDIT_POLICY_VIOLATION: { ...safeUnchanged },
  PROTECTED_ANCHOR_VIOLATION: { ...safeUnchanged },
  SLIDE_UPDATE_FIELD_NOT_ALLOWED: { ...safeUnchanged, impact: 'document' },
  SEMANTIC_KEY_DUPLICATE: { ...safeUnchanged, impact: 'document' },
  SEMANTIC_LINEAGE_AMBIGUOUS: { ...safeUnchanged, impact: 'content' },
  SEMANTIC_LINEAGE_CYCLE: { ...safeUnchanged, impact: 'content' },
  ELEMENT_ID_DUPLICATE: { ...safeUnchanged, impact: 'document' },
  READING_ORDER_INVALID: { ...safeUnchanged, impact: 'document' },
  FACT_REFERENCE_MISSING: { ...unsafeResource, impact: 'content' },
  SOURCE_REFERENCE_MISSING: { ...unsafeResource, impact: 'content' },
  FACT_DISPLAY_INCONSISTENT: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the Fact references and run an explicit Fact synchronization transaction.' },
  CHART_FACT_INCONSISTENT: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the chart data and run an explicit Fact synchronization transaction.' },
  FACT_SYNC_CONFLICT: { ...safeUnchanged, impact: 'content', recovery: 'Provide the previous displayed Fact value or an explicit unique display range, then preview the synchronization again.' },
  SOURCE_CITATION_MISSING: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Add a displayable citation or remove the source reference before export.' },
  CHART_TYPE_UNSUPPORTED: { ...readonlyPackage, impact: 'content', recovery: 'Use a GA-B Bar, Line, or Pie chart, or keep the document in a forward-compatible profile.' },
  FLAT_GROUP_DUPLICATE_MEMBER: { ...safeUnchanged, impact: 'document' },
  FLAT_GROUP_NESTING_NOT_ALLOWED: { ...safeUnchanged, impact: 'document' },
  FLAT_GROUP_MISSING_MEMBER: { ...safeUnchanged, impact: 'document' },
  STYLE_BINDING_MISSING: { ...safeUnchanged, impact: 'document' },
  STYLE_PRESET_MISSING: { ...safeUnchanged, impact: 'document' },
  STYLE_PRESET_INVALID: { ...safeUnchanged, impact: 'document' },
  STYLE_THEME_INVALID: { ...safeUnchanged, impact: 'document' },
  STYLE_TOKEN_MISSING: { ...safeUnchanged, impact: 'document' },
  STYLE_TOKEN_INVALID: { ...safeUnchanged, impact: 'document' },
  STYLE_OVERRIDE_INVALID: { ...safeUnchanged, impact: 'document' },
  STYLE_OVERRIDE_DEBT: { impact: 'content', contentSafety: 'safe', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Reset local overrides, reattach the element to a preset, or save the style as a new preset.' },
  GEOMETRY_INVALID: { ...safeUnchanged, impact: 'document' },
  TEXT_OVERFLOW: { impact: 'content', contentSafety: 'safe', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Shorten text, resize the text box, explicitly fit the font, or change overflow policy.' },
  TEXT_FIT_UNRESOLVED: { ...safeUnchanged, impact: 'content' },
  FONT_NOT_READY: { ...retryPersistence, impact: 'content', recovery: 'Wait for the declared font or choose an explicit safe fallback before measuring.' },
  FONT_GLYPH_MISSING: { ...unsafeResource, impact: 'content', recovery: 'Choose a compatible font, add declared coverage, or cancel the edit.' },
  ASSET_MISSING: { ...unsafeResource },
  ASSET_HASH_MISMATCH: { ...unsafeResource, retryable: true, recoverability: 'retry' },
  ASSET_PATH_INVALID: { ...unsafeResource, impact: 'security' },
  ASSET_METADATA_MISSING: { ...unsafeResource, impact: 'compatibility' },
  ASSET_PAYLOAD_MISSING: { ...unsafeResource, impact: 'compatibility' },
  FONT_MISSING: { ...unsafeResource, impact: 'resource' },
  FONT_HASH_MISMATCH: { ...unsafeResource, retryable: true, recoverability: 'retry' },
  FONT_METADATA_MISSING: { ...unsafeResource, impact: 'compatibility' },
  FONT_PAYLOAD_MISSING: { ...unsafeResource, impact: 'compatibility' },
  JOURNAL_BASE_MISMATCH: { ...journalPersistence, contentSafety: 'unknown', recovery: 'Do not replay automatically; retain the journal and compare its base revision with the checkpoint.' },
  JOURNAL_CORRUPT: { ...journalPersistence, contentSafety: 'unknown', recovery: 'Use the last complete valid journal record, preserve the corrupt tail, and keep the checkpoint readable.' },
  CHECKPOINT_FAILED: { ...retryPersistence },
  PATCH_BASE_MISMATCH: { ...safeUnchanged, impact: 'compatibility', recovery: 'Compare against the patch Base Revision and apply only explicitly accepted operations.' },
  PATCH_CONFLICT: { ...safeUnchanged, impact: 'content', recovery: 'Review the conflicting field and accept one side explicitly.' },
  PORTABLE_PROFILE_UNSUPPORTED: { ...readonlyPackage },
  PORTABLE_INVALID: { ...unsafeResource, impact: 'compatibility' },
  PORTABLE_ORIGIN_MISSING: { ...unsafeResource, impact: 'compatibility' },
  PORTABLE_ORIGIN_MISMATCH: { ...unsafeResource, impact: 'compatibility' },
  PORTABLE_CAPABILITY_MISMATCH: { ...unsafeResource, impact: 'compatibility' },
  PORTABLE_BUDGET_EXCEEDED: { ...unsafeResource, impact: 'resource' },
  PORTABLE_EDIT_UNSUPPORTED: { ...readonlyPackage, impact: 'compatibility' },
  EXPORT_DEGRADED: { impact: 'export', contentSafety: 'safe', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the Capability Report and choose a target with the required fidelity.' },
  COMPONENT_FALLBACK_REQUIRED: { ...readonlyPackage, impact: 'export' },
  OPERATION_APPLY_FAILED: { ...safeUnchanged },
  OPERATION_TYPE_MISMATCH: { ...safeUnchanged },
  TRANSACTION_BUILD_FAILED: { ...safeUnchanged, impact: 'transaction' },
  PATCH_APPLY_FAILED: { ...safeUnchanged, impact: 'transaction' },
  CONFIRMATION_REQUIRED: { ...safeUnchanged, impact: 'transaction', recovery: 'Confirm the requested change explicitly before committing it.' },
  REDO_EMPTY: { ...safeUnchanged, impact: 'transaction' },
  UNDO_EMPTY: { ...safeUnchanged, impact: 'transaction' },
  ID_CONFLICT: { ...safeUnchanged, impact: 'document' },
  ELEMENT_MISSING: { ...safeUnchanged, impact: 'document' },
  SLIDE_MISSING: { ...safeUnchanged, impact: 'document' },
  GROUP_MISSING: { ...safeUnchanged, impact: 'document' },
  SELECTION_MISSING: { ...safeUnchanged, impact: 'transaction' },
  RECIPE_MISSING: { ...safeUnchanged, impact: 'content' },
  RECIPE_SLOT_UNAVAILABLE: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Adjust the Recipe inputs or choose a layout with enough slots.' },
  CONTROLLED_RECIPE_FAILED: { ...safeUnchanged, impact: 'content' },
  CONTROLLED_RECIPE_INVALID: { ...safeUnchanged, impact: 'content' },
  UNSUPPORTED_ELEMENT_TYPE: { ...readonlyPackage, impact: 'content' },
  UNSUPPORTED_OPERATION: { ...readonlyPackage, impact: 'transaction' },
  TEXT_INVALID: { ...safeUnchanged, impact: 'content' },
  CANONICAL_NON_FINITE_NUMBER: { ...safeUnchanged, impact: 'document' },
  RENDER_INVALID_NUMBER: { ...safeUnchanged, impact: 'export' },
  ARTWORK_ASSET_UNRESOLVED: { ...unsafeResource, impact: 'content' },
  ARTWORK_METADATA_MISSING: { ...safeUnchanged, impact: 'content' },
  ARTWORK_SAFE_REGIONS_MISSING: { ...safeUnchanged, impact: 'content' },
  ARTWORK_FOCAL_POINT_MISSING: { ...safeUnchanged, impact: 'content' },
  ARTWORK_PALETTE_MISSING: { ...safeUnchanged, impact: 'content' },
  ARTWORK_SAFE_REGION_MISSING: { ...safeUnchanged, impact: 'content' },
  ARTWORK_TEXT_OBSCURED: { ...safeUnchanged, impact: 'content' },
  TOOL_FAILED: { ...safeUnchanged, impact: 'runtime' },
  CHECKPOINT_FAULT_BEFORE_RENAME: { ...retryPersistence },
  CHECKPOINT_FAULT_AFTER_RENAME: { ...retryPersistence, contentSafety: 'unknown' },
  UNEXPECTED_RUNTIME_ERROR: { impact: 'runtime', contentSafety: 'unknown', canSave: false, recoverability: 'journal', retryable: true, recovery: 'Keep the last valid checkpoint and inspect the diagnostic cause before retrying.' },
  JOURNAL_APPEND_FAILED: { ...journalPersistence },
  CHECKPOINT_FAULT_INJECTED: { ...retryPersistence },
  PATCH_INVALID: { ...unsafeResource, impact: 'compatibility' },
  PATCH_PAYLOAD_UNSAFE: { ...unsafeResource, impact: 'security' },
  PORTABLE_PAYLOAD_UNSAFE: { ...unsafeResource, impact: 'security' },
  PORTABLE_NETWORK_DISABLED: { ...unsafeResource, impact: 'security', recovery: 'Remove network references and rebuild a self-contained portable package.' },
  PORTABLE_EXTERNAL_RUNTIME: { ...unsafeResource, impact: 'security' },
  ARCHIVE_INVALID: { ...unsafeResource, impact: 'security' },
  MIGRATION_INPUT_INVALID: { ...safeUnchanged, impact: 'compatibility' },
  MIGRATION_ASSET_MISSING: { ...unsafeResource, impact: 'compatibility' },
  MIGRATION_ASSET_HASH_MISSING: { ...unsafeResource, impact: 'compatibility' },
  MIGRATION_UNSUPPORTED_ELEMENT: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the migration report and preserve the source before accepting the degraded result.' },
  MIGRATION_DEFAULT_THEME: { impact: 'content', contentSafety: 'safe', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the generated Style Preset bindings before accepting the migrated package.' },
  MIGRATION_EMPTY_GROUP: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Inspect the source group and preserve it as an explicit safe fallback if needed.' },
  MIGRATION_FRAME_DEFAULTED: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the migrated slide geometry before accepting it.' },
  MIGRATION_ID_REMAP: { impact: 'document', contentSafety: 'safe', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Use the migration report to update external references.' },
  MIGRATION_RUN_STYLE_DEGRADED: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Split the text or review the retained migration extension.' },
  MIGRATION_SEMANTIC_KEY_AMBIGUOUS: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Confirm the business identity in the migration report before using it for review matching.' },
  MIGRATION_STYLE_PROMOTED: { impact: 'content', contentSafety: 'safe', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Review the promoted typed style overrides.' },
  MIGRATION_STYLE_REATTACHED: { impact: 'content', contentSafety: 'at-risk', canSave: true, recoverability: 'manual', retryable: false, recovery: 'Create a matching preset or review the selected fallback preset.' },
})

export function errorDescriptor(code: string): ErrorDescriptor {
  return ERROR_CATALOG[code] ?? { ...safeUnchanged }
}

export function createPpteError(code: string, message: string, context: Partial<PpteError> = {}): PpteError {
  const descriptor = errorDescriptor(code)
  return {
    code,
    severity: context.severity ?? 'error',
    message,
    impact: context.impact ?? descriptor.impact,
    contentSafety: context.contentSafety ?? descriptor.contentSafety,
    canSave: context.canSave ?? descriptor.canSave,
    recoverability: context.recoverability ?? descriptor.recoverability,
    retryable: context.retryable ?? descriptor.retryable,
    recovery: context.recovery ?? descriptor.recovery,
    slideId: context.slideId,
    elementId: context.elementId,
    semanticKey: context.semanticKey,
    factId: context.factId,
    path: context.path,
    causeId: context.causeId,
  }
}

/** Add default semantics to older ValidationIssue-shaped records. */
export function withErrorSemantics<T extends { code: string; severity: 'error' | 'warning' | 'info'; message: string }>(issue: T): T & Partial<ErrorSemantics> {
  const descriptor = errorDescriptor(issue.code)
  const typed = issue as T & Partial<ErrorSemantics> & { recovery?: string }
  return {
    ...issue,
    impact: typed.impact ?? descriptor.impact,
    contentSafety: typed.contentSafety ?? descriptor.contentSafety,
    canSave: typed.canSave ?? (issue.severity !== 'error' ? true : descriptor.canSave),
    recoverability: typed.recoverability ?? descriptor.recoverability,
    retryable: typed.retryable ?? descriptor.retryable,
    recovery: typed.recovery ?? descriptor.recovery,
  }
}

export function toPpteError(issue: { code: string; severity: 'error' | 'warning' | 'info'; message: string; recovery?: string; [key: string]: unknown }): PpteError {
  return createPpteError(issue.code, issue.message, issue as Partial<PpteError>)
}
