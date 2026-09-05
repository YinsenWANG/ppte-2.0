# Versioned sample resources

`noto-sans-sc-sample-1.woff2` is a readable Noto Sans SC variable font subset,
not a synthetic measurement font. Google/Adobe distribute the upstream font
under SIL OFL 1.1; the complete notice is in `OFL.txt`. `font-1.json` records the
upstream byte hash, font version, subset hash and exact Unicode coverage.
The original was fetched from the Google Fonts `ofl/notosanssc` directory.
No system font bytes are redistributed.

This 119 KiB subset contains printable ASCII and the Chinese/punctuation used
by this sample corpus. It is **not** a general-purpose Chinese font distribution.
Saved sample decks embed these bytes and declare `subset: true`, explicit glyph
coverage, and `editableSafe: true` within that coverage. Editing existing sample vocabulary works;
new vocabulary requires a licensed font with the necessary coverage and a new
render validation. Font fallback does not inherit this corpus's pass result.

To reproduce the subset, use fonttools 4.60.2 and Brotli 1.2.0 with the upstream
file matching the recorded hash. Concatenate printable ASCII and the UTF-8 text
of `packages/layout-recipes/src/design-packs.ts` and
`tests/helpers/design-pack-fixtures.ts` into a text file, then run:

```
pyftsubset NotoSansSC.ttf --text-file=sample-text.txt --flavor=woff2 \
  --output-file=noto-sans-sc-sample-1.woff2 --layout-features='*' \
  --name-IDs='*' --name-languages='*'
```

`visual-1.svg` is an original, script-free PPTe illustration of two linked work
stages, Apache-2.0. It contains no external references, font glyphs, photography,
or third-party brand marks. Its bytes are embedded in saved decks. Each style
uses different placement, framing, scale and border treatment. All displayed
numbers are explicitly fictional regression data, not business claims.
