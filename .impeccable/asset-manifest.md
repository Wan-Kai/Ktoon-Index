# AI Index homepage asset manifest

Approved reference: `.impeccable/mocks/home-a-continuous-sleeves.png`  
Surface brief: `.impeccable/home-surface.md`  
Scope: material assets only; no implementation files changed.

## Produce

| id | source_crop | output_path | strategy | prompt_used | dimensions | format | transparency | deviations | qa_status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `paper-grain` | Full approved mock, cool paper sleeve surfaces | `assets/paper-grain.webp` | Faithful clean material regeneration with the built-in image generator; mirrored 2×2 seamless assembly; flat, uniform, edge-to-edge cold-gray uncoated paper scan | Recoverable through `embed-prompt.mjs --read` via `assets/paper-grain.webp.json`; cold-gray paper sleeve texture centered near `#E7E5DF`, fine pulp fibers, even scan lighting, seamless repeat, no UI/text/edges/shadows | 1600×1600 | WebP, opaque | None | Generated texture is intentionally cleaner and more uniform than the mock so CSS can own all sleeve edges, highlights, and contact shadows | `accepted` |
| `graphite-grain` | Full approved mock, graphite background/crate surfaces | `assets/graphite-grain.webp` | Faithful clean material regeneration with the built-in image generator; mirrored 2×2 seamless assembly; flat, uniform, edge-to-edge matte compressed-board scan | Recoverable through `embed-prompt.mjs --read` via `assets/graphite-grain.webp.json`; near-black pressed-board texture centered near `#111313`, restrained fibers and flecks, even scan lighting, seamless repeat, no UI/text/edges/shadows/grooves | 1600×1600 | WebP, opaque | None | Literal groove geometry from the mock is excluded because code owns it; texture contrast is kept low for readable light typography | `accepted` |

## Reuse / direct

No supplied standalone production raster is reusable. The approved comp is reference-grade and must not ship as a crop.

## Code / semantic

| id | implementation | notes | qa_status |
| --- | --- | --- | --- |
| `sleeve-stack-tabs` | Six semantic section/article layers; CSS owns 3–5px sleeve corners, staggered tabs, overlap order, borders, edge highlights, and low-offset contact shadows. Apply `paper-grain.webp` as a repeating material layer beneath content. | Preserve the continuous single-column stack and responsive reflow; no rasterized card chrome. | `accepted` |
| `catalog-grooves` | Inline authored SVG or CSS repeating geometry for 8–10 concentric 1px arcs in the header corner. | Geometry must remain crisp and responsive; `graphite-grain.webp` supplies only the substrate. | `accepted` |
| `search-slot` | Semantic `<form>` and `<input type="search">`; authored inline SVG search/clear icons; CSS owns border, focus state, slot inset, and result-layer positioning; JS owns query behavior. | Do not rasterize icons, labels, or interactive states. | `accepted` |
| `category-count-track-list` | Semantic headings, tabular count, and ordered three-row lists. CSS grid owns the left/right proportions and row rules; self-hosted fonts own typography. | All copy remains selectable and localized where required. | `accepted` |
| `rating-stamps` | Semantic text badges with CSS border/fill; acid `#B7FF36` is reserved for the highest signal. | No raster stamp sheet is needed. | `accepted` |
| `stylus-locator` | CSS pseudo-elements for the 1px locator line plus transform/transition for the 4px hover/focus sleeve pull. | Respect reduced-motion preferences. | `accepted` |
| `language-switch` | Semantic button and JS state; CSS owns the pill/inline treatment and active-language color. | Interface-only language switch, not content translation. | `accepted` |
| `rules-and-crate-geometry` | CSS borders/pseudo-elements and, where curves are required, authored SVG. | Includes row rules, crate rim, shallow bevel lines, and other deterministic geometry. | `accepted` |

## Omit

| id | reason | qa_status |
| --- | --- | --- |
| `literal-record-objects` | Large records, stylus hardware, album art, and a photographed desk scene contradict the approved non-literal direction. | `accepted` |
| `baked-copy-and-icons` | Titles, descriptions, counts, ratings, search icon, and language labels must remain semantic and interactive. | `accepted` |
| `raster-shadows-borders-corners` | CSS must control elevation, clipping, hover feedback, responsiveness, and accessibility states. | `accepted` |

## Validation

- Both produced assets were visually inspected as full-frame material plates against the approved mock.
- No text, symbols, UI, object edges, vignette, directional lighting, cast shadow, groove geometry, border, or watermark is present.
- Both outputs are opaque square WebP files at 1600×1600.
- Texture fields are low-contrast and uniformly distributed. A mirrored 2×2 assembly makes opposite edges continuous; browser repetition should still use a large tile size so the texture period remains imperceptible.
- `embed-prompt.mjs` uses its WebP sidecar fallback here. Generation intent is stored beside each WebP and was verified with `--read`.

## execution_order

1. Generate and validate `paper-grain`.
2. Generate and validate `graphite-grain`.
3. Convert selected sources to 1600×1600 WebP and embed prompts.
4. Keep all deterministic UI and crate geometry in code.

## blockers

None.

## assumptions

- The generated texture may be applied as a repeating image or subtle material overlay; CSS controls final tint, opacity, blend, edges, highlights, and shadows.
- 1600×1600 provides sufficient source density for the approved desktop surface while avoiding oversized page payloads.
- The approved mock and its embedded prompt are visual references only, not distributable production art.
