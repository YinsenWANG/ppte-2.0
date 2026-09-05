import type { AgentToolName } from './index.js'

export type JsonSchema = Record<string, unknown>

const stringSchema: JsonSchema = { type: 'string' }
const booleanSchema: JsonSchema = { type: 'boolean' }
const slideIdSchema: JsonSchema = { type: 'string', description: 'PPTe slide id.' }
const elementIdSchema: JsonSchema = { type: 'string', description: 'PPTe element id.' }
const stringArraySchema: JsonSchema = { type: 'array', items: stringSchema }
const documentSchema: JsonSchema = { type: 'object', additionalProperties: true }
const slideIrSchema: JsonSchema = { type: 'object', additionalProperties: true, description: 'Validated Slide IR input.' }

const transactionSchema: JsonSchema = {
  type: 'object',
  required: ['transactionId', 'baseRevision', 'actor', 'scope', 'changeContract', 'reason', 'createdAt', 'operations'],
  properties: {
    transactionId: stringSchema,
    baseRevision: stringSchema,
    actor: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string' }, id: stringSchema }, additionalProperties: true },
    scope: {
      type: 'object',
      required: ['kind', 'permissions'],
      properties: {
        kind: { type: 'string', enum: ['selection', 'slide', 'document', 'custom'] },
        slideIds: stringArraySchema,
        elementIds: stringArraySchema,
        semanticKeys: stringArraySchema,
        permissions: stringArraySchema,
        allowInsert: booleanSchema,
        allowDelete: booleanSchema,
      },
      additionalProperties: true,
    },
    changeContract: { type: 'object', required: ['allowedOperationKinds'], additionalProperties: true },
    reason: stringSchema,
    createdAt: stringSchema,
    validationLevel: { type: 'string', enum: ['L1', 'L2', 'L3'] },
    operations: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
    metadata: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
}

function object(properties: Record<string, JsonSchema> = {}, required: string[] = [], additionalProperties = true): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties,
  }
}

function array(items: JsonSchema = stringSchema): JsonSchema {
  return { type: 'array', items }
}

const generatedProperties: Record<string, JsonSchema> = {
  slideId: slideIdSchema,
  slideIR: slideIrSchema,
  recipeId: stringSchema,
  recipeVersion: stringSchema,
  seed: stringSchema,
  transactionId: stringSchema,
  reason: stringSchema,
  createdAt: stringSchema,
  protectedElementIds: stringArraySchema,
  targetElementIds: stringArraySchema,
  protectedSemanticKeys: stringArraySchema,
  requireConfirmation: booleanSchema,
}

/** Agent schemas mirror AgentToolServer.execute; delivery is MCP-owned. */
export const MCP_TOOL_INPUT_SCHEMAS: Record<AgentToolName | 'deliver_presentation', JsonSchema> = {
  inspect_document: object({}, [], false),
  list_slides: object({}, [], false),
  get_slide_summary: object({ slideId: slideIdSchema }),
  query_elements: object({ slideId: slideIdSchema, role: stringSchema, type: { type: 'string', enum: ['text', 'image', 'shape', 'chart', 'component'] }, semanticKey: stringSchema }),
  get_slide: object({ slideId: slideIdSchema }, ['slideId']),
  get_element: object({ slideId: slideIdSchema, elementId: elementIdSchema }, ['elementId']),
  get_selection: object({}, [], false),
  get_theme: object({}, [], false),
  get_facts: object({ factId: stringSchema }),
  get_sources: object({ sourceId: stringSchema }),
  get_validation_issues: object({}, [], false),
  get_editability_report: object({}, [], false),
  render_slide: object({ slideId: slideIdSchema }, ['slideId']),
  inspect_facts: object({ factId: stringSchema }),
  inspect_sources: object({ sourceId: stringSchema }),
  inspect_assets: object({ assetId: stringSchema }),
  inspect_theme: object({}, [], false),
  inspect_history: object({}, [], false),
  search_text: object({ query: stringSchema }),
  query_semantic_keys: object({ query: stringSchema }),
  preview_transaction: object({ transaction: transactionSchema }, ['transaction']),
  commit_transaction: object({ transaction: transactionSchema, confirmed: booleanSchema }, ['transaction']),
  undo_transaction: object({ confirmed: booleanSchema }),
  regenerate_selection: object({ ...generatedProperties, elementIds: stringArraySchema }),
  redesign_others: object({ ...generatedProperties, elementIds: stringArraySchema }),
  regenerate_slide: object(generatedProperties, ['slideId']),
  apply_layout_recipe: object(generatedProperties, ['slideId']),
  expand_macro: object({ macroId: stringSchema, input: {}, slideKey: stringSchema, version: stringSchema, seed: stringSchema }, ['macroId']),
  replace_artwork: object({ slideId: slideIdSchema, elementId: elementIdSchema, assetId: stringSchema, transactionId: stringSchema }, ['slideId', 'elementId', 'assetId']),
  sync_fact_references: object({ factId: stringSchema, targetElementIds: array(stringSchema), strategy: { type: 'string', enum: ['replace-display-value', 'update-chart-values'] }, transactionId: stringSchema, reason: stringSchema, createdAt: stringSchema, requireConfirmation: booleanSchema }, ['factId', 'targetElementIds']),
  compare_revised_copy: object({ revisedDocument: documentSchema, baseDocument: documentSchema }, ['revisedDocument']),
  deliver_presentation: object({
    profile: { type: 'string', enum: ['quick-fix', 'light-edit', 'full-portable'], description: 'Optional editable Portable profile; omitted uses the product default.' },
    replaceExisting: { ...booleanSchema, description: 'Replace the derived sibling only when confirmed is also true.' },
    allowLargePortable: { ...booleanSchema, description: 'Explicitly allow a complete artifact larger than the 20 MiB standard target.' },
    confirmed: { ...booleanSchema, description: 'Required for replacing an existing sibling.' },
  }, [], false),
}
