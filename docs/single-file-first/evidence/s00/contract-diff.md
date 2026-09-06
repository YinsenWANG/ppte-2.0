# S00 contract-diff

Basis: `9856db3cef4da0d6ea6aca5a46b7039a166b995c`; audit: `ea260ce678019c4e88c0ff3a9db4867a311e0b59`.
The original contract is preserved byte-for-byte in `CONTRACT.html-first-1.0.md`;
H00's machine snapshot remains `docs/html-first/evidence/h00/manifest.json`.

| Provision | html-first-1.0 | single-file-first-1.1 |
|---|---|---|
| Default artifact | one `.html` | one `.ppte.html`; explicit `.html` supported; no automatic rename |
| Reader entry | README/Skill recommended `ppte edit` loopback | file:// in supported browser; no Node, network or service |
| edit command | starts loopback and stays alive | target opens file and exits; implementation explicitly pending S01 |
| Save | original-file write confirmation; service recommended | actual handle authorization; write + close + readback; fallback complete updated-file download |
| Save status | draft is not saved | draft AND download are not original-file saves; download initiation not disk confirmation |
| Service | recommended in old PLAN §5 | recommendation retired, including as mandatory permission fallback |
| Representation/security | native DOM/CSS, minimal metadata, isolation/CSP | retained unchanged |
| Retired scope | Office, ZIP/IR and related legacy chain | retained; no new MCP/QuickJS/Electron/reader dependency |
| Evidence | H00's original version and pending measurements | separate version; strict explicit selection, no historical relabelling |

Only active instructions and CLI help change here. The existing edit implementation
is intentionally documented as a migration gap, not described as open-and-exit
already. No existing output is renamed; CLI generation keeps its exclusive-write
protection. Runtime, package manifests and lockfile are unchanged.

Tests: `tests/single-file-contract.test.ts` covers version rejection, identical
measurement requirements, active instructions/real CLI help, real enhancement for
both extensions, overwrite refusal and hashes of historical evidence/samples.
`tests/html-first-baseline.test.ts` retains every old assertion with explicit H00
version selection. H00 task metadata remains historical; `currentContract` links
to the new policy without changing any H00–H06 status or evidence.
