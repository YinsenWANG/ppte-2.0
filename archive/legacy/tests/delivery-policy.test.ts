import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assessDeliveryArtifact,
  deliveryRoleLabel,
  resolveDeliveryPolicy,
  STANDARD_ARTIFACT_TARGET_BYTES,
  STANDARD_DELIVERY_PROFILE,
  STANDARD_EDITABLE_SUFFIX,
} from '../packages/portable-runtime/src/index.js'

test('delivery policy has one editable default and a 20 MiB artifact SLO', () => {
  const policy = resolveDeliveryPolicy()
  assert.equal(STANDARD_DELIVERY_PROFILE, 'full-portable')
  assert.equal(policy.profile, 'full-portable')
  assert.equal(policy.editableSuffix, '.editable.ppte.html')
  assert.equal(STANDARD_EDITABLE_SUFFIX, policy.editableSuffix)
  assert.equal(STANDARD_ARTIFACT_TARGET_BYTES, 20 * 1024 * 1024)
  assert.equal(policy.artifactTargetBytes, STANDARD_ARTIFACT_TARGET_BYTES)
  assert.equal(deliveryRoleLabel('editable-browser-copy'), '浏览器可编辑副本')
  assert.equal(deliveryRoleLabel('source-project'), 'PPTe Host 源项目')
})

test('delivery policy rejects viewer and does not silently downgrade large artifacts', () => {
  assert.throws(() => resolveDeliveryPolicy('viewer'), /DELIVERY_PROFILE_UNSUPPORTED/)
  const policy = resolveDeliveryPolicy()
  const metrics = { bytes: STANDARD_ARTIFACT_TARGET_BYTES + 1, runtimeGzipBytes: 100, resourceBytes: 20, budgetBytes: policy.runtimeBudgetBytes }
  const rejected = assessDeliveryArtifact(metrics, policy)
  assert.deepEqual({ ok: rejected.ok, code: rejected.code }, { ok: false, code: 'DELIVERY_ARTIFACT_LARGE' })
  assert.equal(assessDeliveryArtifact(metrics, policy, true).ok, true)
  assert.equal(assessDeliveryArtifact({ ...metrics, bytes: 1, runtimeGzipBytes: policy.runtimeBudgetBytes + 1 }, policy).code, 'PORTABLE_BUDGET_EXCEEDED')
})
