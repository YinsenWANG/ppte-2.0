import { canonicalHash, sha256HexBytes } from '../../canonical-json/src/index.js'
import { profileDescriptor } from '../../compatibility/src/index.js'
import type { PortablePayload } from './shared.js'

import type { ArtifactIdentity } from '../../schema/src/file-format.js'
export type { ArtifactIdentity } from '../../schema/src/file-format.js'

/** Hash decoded bytes individually; base64 spelling is not resource identity. */
function resourceManifest(resources: Record<string, string>) {
  return Object.fromEntries(Object.entries(resources).map(([id, encoded]) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    return [id, { byteLength: bytes.length, digest: sha256HexBytes(bytes) }]
  }))
}

/** Bind the artifact to its actual embedded executable, surface, resources and history. */
export function computeArtifactIdentity(payload: PortablePayload, html: string): ArtifactIdentity {
  const runtime = /<script id="ppte-runtime">([\s\S]*?)<\/script>/.exec(html)?.[1]
  const surface = /<main class="ppte-stage"[\s\S]*?<\/main>/.exec(html)?.[0]
  if (runtime === undefined || surface === undefined) throw new Error('ARTIFACT_IDENTITY_INVALID: missing runtime or rendered surface')
  const shell = html.replace(/<script id="ppte-portable-payload" type="application\/json">[\s\S]*?<\/script>/, '<!-- payload -->').replace(/<script id="ppte-runtime">[\s\S]*?<\/script>/, '<!-- runtime -->')
  const components: ArtifactIdentity['components'] = {
    document: canonicalHash(payload.document),
    runtime: sha256HexBytes(new TextEncoder().encode(runtime)),
    renderer: canonicalHash({ executable: runtime, surface }),
    shell: canonicalHash(shell),
    resources: canonicalHash({ declarations: payload.document.assets, bytes: resourceManifest(payload.assets) }),
    fonts: canonicalHash({ declarations: payload.document.fonts, bytes: resourceManifest(payload.fonts), policyVersion: payload.fontPolicyVersion ?? '1' }),
    history: canonicalHash({ undo: payload.recentTransactions ?? [], redo: payload.redoHistory ?? [] }),
    capabilities: canonicalHash(payload.capabilityReport),
    compatibility: canonicalHash(payload.compatibilityDescriptor ?? profileDescriptor(payload.minimumCompatibilityProfile!)),
    configuration: canonicalHash({ buildVersion: payload.buildVersion ?? null, profile: payload.origin.profile, runtimeVersion: payload.origin.runtimeVersion, branchId: payload.origin.branchId ?? null, exportOptions: payload.exportOptions ?? {}, buildManifest: payload.buildManifest ?? null }),
  }
  return { version: 1, digest: canonicalHash({ version: 1, components }), components }
}
