# Design asset contracts v1 (D01)

`PresentationIR`, `RecipeSpec` and `ThemeDefinition` remain the input, layout and
theme contracts. `DesignPlan` references the existing IR; `DesignBinding` contains
identities, applied parameter values and override field names, never a second
copy of text or slots. Finished documents do not require these packages to open.

`createRecipeManifest` generates purpose, slotRefs, structural fingerprint and
digest from RecipeSpec. `validateRecipeManifest` verifies these against the exact
recipe. The manifest never defines slots. `validateStylePack` uses the shared
ThemeDefinition validator, and `compileBrandTheme` copies brand color/font values
into a regular ThemeDefinition without mutating inputs. Logo references identify
ordinary document assets; loading bytes is the caller's resource responsibility.

`designRuleLayers` separates brand requirements (error), recipe requirements
(error), and aesthetic advice (suggestion). Safe areas and forbidden rules remain
brand requirements, not stylistic scores. D01 defines these contracts; parameter
layout execution and capacity measurement belong to D02/D03, not this package.
`resolveParameters` validates and fills defaults; it does not rearrange content.

## Trust, licensing and versions

The digest is `sha256-` plus the existing canonical JSON SHA-256 of all package
fields except the top-level `digest`. Recipe references pin the complete recipe;
structural fingerprints cover slots, zones, constraints, variants and quality
rules. A caller-controlled trust allowlist contains accepted *digests*, not a
self-declared trusted flag. There is no script, CSS or JSON-path execution.
License entries identify each brand/logo, font, photo, recipe or preview resource,
its source and notice. The caller must explicitly allow each license. The example
policy allows only Apache-2.0; AGPL and unknown licenses fail closed. Font names in
the synthetic fixture do not license font binaries; no font bytes are included.

Exact stable `major.minor.patch` versions are required. `resolvePackage` supports
an old pinned version only when that exact package and digest are available;
missing, ambiguous or changed packages fail, with no latest-version substitution.
Unknown contract versions require explicit migration while retaining the original.
Neither version resolution nor validation performs a migration or downloads code.

## Parameters, samples and reports

Only columns (1/2/3), captionDensity (low/medium/high) and imageSide (left/right)
are recognized. Controls define labels, defaults, bounded option subsets, slot
applicability and a fixed impact category. Unknown names or values fail; columns
never authorizes content truncation. See `recipe-manifest.schema.json`'s
`$defs.parameters` for the applied-value schema. Cross-field default/range,
slot-reference and digest checks are performed by the runtime validator.

The checked-in synthetic contracts include normal, boundary and overload
PresentationIR inputs with Chinese punctuation, supplementary CJK and long
numbers. The block budget uses exact block counts; text pressure is defined in
Unicode code points, not bytes/UTF-16 units. Overflow policy is reject-or-propose;
D02/D03 must enforce slot/text/geometry capacities and return a bounded alternative
without truncation or automatic scope expansion. These fixtures establish input
contracts, not visual maturity. Capability entries can only be unverified or
unsupported; later build-bound measurement/export reports must supply evidence
rather than promoting a static package claim to verified.

## Protection and writes

`regenerationProtectedIds` re-reads current objects' locked/editPolicy state and
all element/semantic/fact page anchors. IR protectedContent is an additive union;
empty or absent IR protection cannot remove existing protection. Whole-object
replacement conservatively retains protected objects unless a matching draft can
replace an unlocked object by copying all current values, including protected
content. This preserves existing regeneration semantics while preventing stale IR
from changing any protected field. Locks and request-added protection retain the
original instance and reject selection replacement. The compiler uses this union. Drafts
matching retained objects by semantic identity or current source ID are excluded
from reinsertion. There is no stored protection snapshot to override live state.
All results remain drafts/transactions; only the Operation Engine commits writes.

Tests: `tests/design-system-contract.test.ts` (node --test after build). Literal
schemas use the same Python/jsonschema environment as existing E08 schema tests;
all references are resolved from repository files without network access.
