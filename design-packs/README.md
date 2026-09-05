# D04 design packs · 1.0.0

Four opt-in, declarative style packs cover eight roles each: cover, section,
statement, metrics, explanation, comparison, process and closing. Open
[index.html](index.html) to review the checked-in previews, including rejected
input previews. All example numbers are fictional regression data.

| Pack | Composition and rhythm | Typography at 720 du | Image treatment |
| --- | --- | --- | --- |
| business | conclusion above evidence; sidebars; paired comparison and steps | 48 / 26, weight 600 title | compact frame, fine border |
| swiss | asymmetric grid; separate numeric anchor; vertical comparison/steps | 62 / 27, weight 800 title | hard edges; wide cover, tall explanation |
| editorial | indented statement; narrow columns; quiet chapter and close | 50 / 28, weight 400 title | tall opening, left-hand explanation |
| launch | broad headline region; dominant visual; horizontal feature/step sequence | 56 / 27, weight 700 title | large rounded frame |

These differences are stored in actual `RecipeSpec` geometry and theme presets.
Each role has three named zones. Two narrative blocks may share the middle
zone using declarative repeat; each recipe accepts at most four blocks. The
normal sample uses three, the boundary sample four, and overload five. Per-slot
text limits also reject excess content. A rejection retains the input and
proposes splitting or choosing a larger recipe; it never silently shrinks text
or drops a block. Typography scales with canvas height. Geometry is tested at
1280×720, 1920×1080 and 1600×1200; all mature screenshots use 1280×720.

`manifest.json` follows the existing StylePack contract and pins eight recipe
references by exact version and digest. `recipes.json` is the corresponding
plain declarative catalogue. `tests/fixtures/evolution/design-pack-manifest.json`
contains the 96 PresentationIR samples, twelve stress samples, per-resource
hashes/licenses and 108 real PNG hashes. Each pack uses the same original
illustration and a licensed, pinned readable Chinese font subset; details and
coverage limitations are in [assets/README.md](assets/README.md).

Register these recipes explicitly; default built-in selection remains stable:

```ts
const recipes = new RecipeRegistry(designPackRecipeSpecs('business'))
const theme = designPackTheme('business', canvas.height)
const draft = compileSlide(slideIR, {
  canvas, theme, recipes, recipeId: 'business.cover',
  seed: 'my-deck', fontMetricsFingerprint: pinnedFontDigest,
})
// The target document owns the theme, canvas background, image and font bytes.
// Commit the resulting draft through buildInitializationTransaction / PpteSession.
```

Persisted slides contain ordinary text/image/chart/component elements and their
resolved geometry, theme and resources. Opening or exporting the checkpoint
requires no style manifest or recipe execution. The tests edit native text,
undo/redo, save/reopen with history, and export from a fresh process whose working
directory contains only the checkpoint and an opener. The table pressure pages
use `core/table` **1.0.0**, retain scalar types and line breaks, and exercise its
existing HTML rendering. They make no Table v2/native table export claim.

Run `pnpm build && node --test dist/tests/design-pack-coverage.test.js` to produce
fresh, network-blocked Chromium screenshots and `artifacts/d04/report.json`.
The gate fails on font loading/fallback, text overflow, accidental overlaps,
missing data, or absent screenshots. Reports include build, fixture, font,
resource and test-harness digests, environment and browser version.
`render-evidence.json` is the checked-in authoring run, not a claim that an old
report validates a changed build. Every test run measures the current build.

Explicitly reauthor previews with:

```
pnpm build
node scripts/build-design-pack-fixtures.mjs
```

Review the resulting visual changes before committing. Tests never replace
source previews. Overload PNGs show the diagnostic and entire retained input,
not an invented successful slide. The 76 mature pages have actual Chromium
render evidence. Office client fidelity, Safari and the wider G2 human editing
study remain unverified; passing this D04 gate does not mark all of G2 complete.
