import { contentOnlyContract } from '../../change-contract/src/index.js'
import { cloneJson } from '../../canonical-json/src/index.js'
import type { PpteDocument, Transaction } from '../../schema/src/index.js'

export interface PlanContext { document: Readonly<PpteDocument>; revision: string }
export type CommandPlanner<T = Transaction> = (context: PlanContext, input: T) => Transaction | undefined
/** Pure CLI-compatible identity planner: never silently rebases a prepared edit. */
export const planTransaction: CommandPlanner = (_context, transaction) => cloneJson(transaction)
export class CommandRegistry {
  private planners = new Map<string, CommandPlanner<unknown>>()
  register<T>(name: string, planner: CommandPlanner<T>): () => void {
    if (this.planners.has(name)) throw new Error(`COMMAND_DUPLICATE: ${name}`)
    this.planners.set(name, planner as CommandPlanner<unknown>)
    return () => { if (this.planners.get(name) === planner) this.planners.delete(name) }
  }
  plan(name: string, context: PlanContext, input: unknown): Transaction | undefined {
    const planner = this.planners.get(name)
    if (!planner) throw new Error(`COMMAND_UNKNOWN: ${name}`)
    return planner(context, input)
  }
}

export interface TextReplacementPlan {
  transactionId: string
  baseRevision: string
  slideId: string
  elementId: string
  content: import('../../schema/src/index.js').RichTextDocument
  createdAt: string
  actor?: Transaction['actor']
  opId?: string
  reason?: string
  validationLevel?: Transaction['validationLevel']
}
/** Text input adapters supply semantic content, never HTML or platform selection. */
export function planTextReplacement(input: TextReplacementPlan): Transaction {
  const { transactionId, baseRevision, slideId, elementId, content, createdAt } = input
  return {
    transactionId, baseRevision, createdAt,
    actor: input.actor ?? {type:'human',id:'editor'},
    scope: {kind:'selection',slideIds:[slideId],elementIds:[elementId],permissions:['content'],allowInsert:false,allowDelete:false},
    changeContract: contentOnlyContract(elementId),
    ...(input.reason ? {reason:input.reason} : {}),
    ...(input.validationLevel ? {validationLevel:input.validationLevel} : {}),
    operations: [{opId:input.opId ?? `${transactionId}:replace`,kind:'text.replaceContent',slideId,elementId,content:cloneJson(content)}],
  }
}
