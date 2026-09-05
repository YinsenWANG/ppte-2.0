# Authoring input

`ppte compile` accepts either a Presentation IR or an envelope containing `presentation`, optional `sources`, `facts`, `theme`, `assets`, `fonts`, and base64 `assetBytes`/`fontBytes` keyed by resource IDs. Byte lengths and SHA-256 hashes must match the resource metadata. Use the host's image tools to obtain or create real images before embedding them. No model output is executed as code.

A minimal two-page envelope:

```json
{
  "presentation": {
    "irVersion": "1.0",
    "title": "Quarterly review",
    "audience": "Management",
    "objective": "Review performance and agree next actions",
    "narrative": [{"key":"review","title":"Review","slideKeys":["performance","actions"]}],
    "slides": [
      {
        "irVersion":"1.0","slideKey":"performance","purpose":"explanation",
        "message":"Revenue increased","visualStrategy":"structured","density":"low",
        "blocks":[
          {"key":"title","kind":"heading","content":"Revenue increased","importance":"primary"},
          {"key":"body","kind":"paragraph","content":"Use the actual verified revenue and comparison from the user's brief.","importance":"secondary","sourceIds":["brief"]}
        ],
        "sourceIds":["brief"]
      },
      {
        "irVersion":"1.0","slideKey":"actions","purpose":"explanation",
        "message":"Agree next actions","visualStrategy":"structured","density":"low",
        "blocks":[
          {"key":"title","kind":"heading","content":"Agree next actions","importance":"primary"},
          {"key":"body","kind":"paragraph","content":"Use the actual owners, actions and deadlines in the brief; distinguish proposals from commitments.","importance":"secondary"}
        ]
      }
    ]
  },
  "sources":{"brief":{"id":"brief","title":"User-provided quarterly brief","citation":"Replace with the actual file or source citation"}}
}
```

The example illustrates structure, not finished slide content. Replace its instructional copy. For an actual ten-page test design see the package's `examples/quarterly-design.json` and its paired `quarterly-brief.txt` (explicitly fictional test data).

Every slide has a unique `slideKey`; every block a unique key within that slide. If `semanticKey` is omitted the compiler scopes it to the slide. Explicit semantic keys must be globally unique. The compiler selects a declared Recipe; `layoutIntent.preferredRecipeIds` can guide selection. Use `ppte tool ... apply_layout_recipe` to preview an alternative layout on an existing slide.

Charts use structured columns, rows and encoding in `block.content`; images use `{ "assetId": "..." }`. The envelope supplies resource definitions and bytes. Source/fact IDs must resolve. The compiler rejects malformed IR and critical text overflow; simplify wording or choose a suitable layout rather than silently shrinking important text or converting it to a screenshot.
