import { canonicalHash } from '../../canonical-json/src/index.js'
import { profileDescriptor } from '../../compatibility/src/index.js'
import type { PortablePayload } from './shared.js'

export interface ArtifactIdentity {
  version: 1
  digest: string
  components: Record<'document' | 'runtime' | 'renderer' | 'shell' | 'resources' | 'fonts' | 'history' | 'capabilities' | 'compatibility' | 'configuration', string>
}

/** Bind the artifact to its actual embedded executable, surface, resources and history. */
export function computeArtifactIdentity(payload: PortablePayload, html: string): ArtifactIdentity {
  const runtime = /<script id="ppte-runtime">([\s\S]*?)<\/script>/.exec(html)?.[1]
  const surface = /<main class="ppte-stage"[\s\S]*?<\/main>/.exec(html)?.[0]
  if (runtime === undefined || surface === undefined) throw new Error('ARTIFACT_IDENTITY_INVALID: missing runtime or rendered surface')
  const shell = html.replace(/<script id="ppte-portable-payload" type="application\/json">[\s\S]*?<\/script>/, '<!-- payload -->').replace(/<script id="ppte-runtime">[\s\S]*?<\/script>/, '<!-- runtime -->')
  const components: ArtifactIdentity['components'] = {
    document: canonicalHash(payload.document),
    runtime: canonicalHash(runtime),
    renderer: canonicalHash(surface),
    shell: canonicalHash(shell),
    resources: canonicalHash(payload.assets),
    fonts: canonicalHash(payload.fonts),
    history: canonicalHash({ undo: payload.recentTransactions ?? [], redo: payload.redoHistory ?? [] }),
    capabilities: canonicalHash(payload.capabilityReport),
    compatibility: canonicalHash(profileDescriptor(payload.minimumCompatibilityProfile!)),
    configuration: canonicalHash({ buildVersion: payload.buildVersion ?? null, profile: payload.origin.profile, runtimeVersion: payload.origin.runtimeVersion, branchId: payload.origin.branchId ?? null }),
  }
  return { version: 1, digest: canonicalHash({ version: 1, components }), components }
}
