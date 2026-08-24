---
version: 1
slug: "detail-html"
primary_target: "detail.html"
related_targets: ["detail.css","app.js"]
---

# Detail surface brief

- **Mode and job:** Read mode for the owner or a public visitor opening one indexed item to understand the owner's short judgment and reach its original materials quickly.
- **Content and hierarchy:** The return action participates in the folio's normal flow; title, one-line deck, and the editorial rating mark then share one full-width newspaper-style band. Below it, the short personal evaluation is primary; one main external link follows; multiple supporting links form the terminal reference index. Metadata includes categories, flat tags, added date, link count, and archive ID. A blank upper-right index slip contributes physical filing context only.
- **Direction:** An expanded newspaper dossier pulled from the existing Crate Index. Desktop uses a narrow metadata rail beside a broad reading field with a two-column owner note; mobile stacks folio, headline/rating, metadata, judgment, action, and references. The memorable moment is one complete paper record opening inside the graphite tray.
- **Boundaries:** No copied article body, table of contents, recommendations, previous/next navigation, social controls, editing controls, or new visual identity. Search and interface-only language switching remain available.
- **Approved comp:** `.impeccable/mocks/detail-a-approved.png`. The generated stamp and folder geometry guide hierarchy and physicality; all real UI text, links, semantics, and responsive behavior remain authored HTML/CSS.

## Reviewed v6 surface contract

- **Paper silhouette:** The main paper sheet fills the dossier at `inset: 0`, retains one uninterrupted paper surface, and exposes four softly rounded corners. There is no upper-left protruding tab and the sheet is not vertically lowered.
- **Return entry:** “返回工具箱” is plain IBM Plex Mono text plus a short arrow in the folio's normal flow. It has no button background, pill, border box, or raised-control silhouette; hover/focus may use text decoration and color only.
- **Layer contract:** The dossier establishes an isolated stacking context. The blank right slip is layer 0, the uninterrupted inset-0 paper is layer 1, and folio/header/body content is layer 2. The main paper masks every inward portion of the slip. The slip must never overlap the paper face and appear as a white repair patch.
- **Right index slip:** On desktop the blank paper-textured slip is 64px high at `top: 48px` and exposes only 14px beyond the right edge. On mobile it is 50px high at `top: 44px` and exposes only 6px. It contains no copy or control and reads exclusively as a rear sheet projecting outward, never an inward notch.
- **Folio:** Use a compact 38px band with 18px horizontal padding. Archive information is 9px IBM Plex Mono. “返回工具箱” is 10px mono with a 17px short arrow, remains in normal folio flow, and stays unboxed.
- **Headline band:** The compressed folio is followed by a full-width editorial header. The serif title is the dominant typographic event; its deck uses restrained IBM Plex Sans Condensed beneath a solid rule. The header also contains the rating mark without shrinking the title into the reading column.
- **Editorial rating mark:** Strong solid rules frame compact edition/label copy and one acid-green `夯` grade block. A slight print rotation is permitted. Never substitute a circular seal, generic icon, floating badge, or status pill.
- **Single-rule hierarchy:** The detail dossier prohibits `double` borders everywhere. Use 1px solid hairlines for rows, 2px solid boundaries for secondary sections/actions, and 4px solid rules for primary editorial divisions. Never recreate a double-line effect with pseudo-elements or adjacent strokes.
- **Type roles:** Georgia with Songti-compatible serif fallbacks carries headline, editorial headings, personal judgment, and supporting explanatory copy. IBM Plex Sans Condensed carries deck, actions, and reference titles. IBM Plex Mono carries folio and archive data. The minimal Noto CJK subset is reserved for the rating grade character.
- **Body structure:** Below the headline, a narrow tinted metadata rail sits beside the reading field. The owner's judgment uses two balanced serif columns with a fine rule and no drop cap, leaving the oversized rating character as the stronger editorial mark. The primary source is a ruled acid strip. Related materials end the page as a numbered three-column index.
- **Responsive transformation:** At 820px and below, use one column in the order folio → headline/rating → metadata → judgment → primary source → references. The main sheet remains inset 0 at layer 1, the blank rear slip uses its 50px/44px/6px mobile geometry at layer 0, metadata becomes a horizontal band, judgment and references stack, and page-specific crate grips disappear.
- **Boundary:** These v6 rules belong to the detail dossier only. They do not replace or reinterpret the homepage Continuous Sleeves geometry, stacking, shadows, motion, category order, borders, or its League Gothic / Plex / Noto type roles.
