import { canonicalHash } from '../../canonical-json/src/index.js'
import type { ArtifactIdentity } from '../../schema/src/file-format.js'

export type ClientCheck = 'open' | 'edit' | 'resave' | 'native-text' | 'native-shape' | 'native-image' | 'native-chart' | 'native-table' | 'text-order' | 'visual' | 'journey'
export interface ClientMatrix {
  version: 'q01-client-matrix-v1'
  clients: { id: string; application: string; kind: 'browser' | 'office'; required: boolean; entries: string[]; checks: ClientCheck[] }[]
}
export interface ClientEvidence {
  clientId: string; entry: string; check: ClientCheck
  status: 'not-run' | 'pass' | 'fail' | 'blocked' | 'unverified' | 'not-applicable'
  method: 'actual-client' | 'playwright-webkit' | 'package-inspection'
  application: string; version: string; os: string; device: string; executedBy: string; executedAt: string
  artifactIdentity: ArtifactIdentity
  input: { path: string; sha256: string }
  evidence: { path: string; sha256: string }[]
  scenario: string; operations: string[]; expected: string; actual: string; revision: string; historyDigest: string
}
export interface ClientSubmission {
  version: 'q01-client-evidence-v1'; matrixDigest: string; artifactIdentity: ArtifactIdentity; observations: ClientEvidence[]
}
const identityKeys = ['document', 'runtime', 'renderer', 'shell', 'resources', 'fonts', 'history', 'capabilities', 'compatibility', 'configuration'] as const
const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const nonempty = (s: unknown) => typeof s === 'string' && s.trim().length > 0
export function validAcceptanceIdentity(value: ArtifactIdentity): boolean {
  return !!value && value.version === 1 && !!value.components && identityKeys.every(key => hash(value.components[key])) &&
    Object.keys(value.components).length === identityKeys.length && value.digest === canonicalHash({ version: 1, components: value.components })
}

/** Read-only evidence gate, not an attestation that a human actually performed the recorded actions.
 * The caller must recompute current identity from the deliverable and verify all retained file bytes.
 * Structural PPTX inspection and WebKit automation cannot establish actual-client acceptance.
 */
export function evaluateClientAcceptance(matrix: ClientMatrix, submission: ClientSubmission, current: ArtifactIdentity,
  verifyFile: (file: { path: string; sha256: string }) => boolean = () => false) {
  const blockers: string[] = []
  const rows: { clientId: string; entry: string; check: ClientCheck; status: 'pass' | 'fail' | 'unverified' }[] = []
  if (matrix.version !== 'q01-client-matrix-v1' || !matrix.clients.length || new Set(matrix.clients.map(c => c.id)).size !== matrix.clients.length ||
    !matrix.clients.some(c => c.required && c.application === 'Safari' && c.kind === 'browser') ||
    !matrix.clients.some(c => c.required && c.kind === 'office')) blockers.push('invalid-client-matrix')
  const identityMatches = validAcceptanceIdentity(current) && validAcceptanceIdentity(submission.artifactIdentity) && canonicalHash(current) === canonicalHash(submission.artifactIdentity)
  if (submission.version !== 'q01-client-evidence-v1' || submission.matrixDigest !== canonicalHash(matrix)) blockers.push('stale-matrix')
  if (!identityMatches) blockers.push('stale-artifact-identity')
  const file = (value: { path: string; sha256: string }) => {
    try { return !!value && nonempty(value.path) && hash(value.sha256) && verifyFile(value) === true } catch { return false }
  }
  for (const client of matrix.clients) {
    const requiredChecks: ClientCheck[] = client.kind === 'office' ? ['open', 'edit', 'resave', 'native-text', 'native-shape', 'native-image', 'native-chart', 'native-table', 'text-order', 'visual'] : ['open', 'edit', 'resave', 'visual', 'journey']
    if (!client.entries.length || new Set(client.entries).size !== client.entries.length || new Set(client.checks).size !== client.checks.length || requiredChecks.some(c => !client.checks.includes(c))) blockers.push(`${client.id}:incomplete-protocol`)
    for (const entry of client.entries) for (const check of client.checks) {
      const matches = submission.observations.filter(o => o.clientId === client.id && o.entry === entry && o.check === check)
      const o = matches[0]
      const complete = matches.length === 1 && o && identityMatches && validAcceptanceIdentity(o.artifactIdentity) && canonicalHash(o.artifactIdentity) === canonicalHash(current) &&
        o.method === 'actual-client' && o.application === client.application &&
        [o.version, o.os, o.device, o.executedBy, o.scenario, o.expected, o.actual, o.revision].every(nonempty) &&
        Number.isFinite(Date.parse(o.executedAt)) && o.revision === current.components.document && o.historyDigest === current.components.history &&
        o.operations.length > 0 && o.operations.every(nonempty) && file(o.input) && o.evidence.length > 0 && o.evidence.every(file) &&
        (check !== 'visual' || o.evidence.some(e => /\.(png|jpg|jpeg)$/i.test(e.path))) &&
        (check !== 'resave' || o.evidence.some(e => e.path !== o.input.path && e.sha256 !== o.input.sha256))
      const status = o?.status === 'fail' ? 'fail' : complete && o.status === 'pass' ? 'pass' : 'unverified'
      rows.push({ clientId: client.id, entry, check, status })
      if (client.required && status !== 'pass') blockers.push(`${client.id}:${entry}:${check}:${status}`)
    }
  }
  if (submission.observations.some(o => !matrix.clients.some(c => c.id === o.clientId && c.entries.includes(o.entry) && c.checks.includes(o.check)))) blockers.push('unknown-observation')
  return { status: blockers.length ? 'blocked' as const : 'pass' as const, artifactIdentity: current, matrixDigest: canonicalHash(matrix), rows, blockers }
}
