---
name: "Ktoon’s Index"
description: Ktoon’s tactile, public index for personal AI knowledge — Crate Index / Continuous Sleeves.
colors:
  graphite: "#111313"
  crate: "#161918"
  paper: "#e7e5df"
  ink: "#171918"
  metal: "#747a7a"
  acid: "#b7ff36"
  text-on-graphite-muted: "#aeb3b0"
  text-on-paper-muted: "#3f4643"
  paper-line: "rgba(23, 25, 24, 0.18)"
typography:
  brand:
    fontFamily: '"Iowan Old Style", Baskerville, "Palatino Linotype", "Book Antiqua", Georgia, serif'
    fontSize: "clamp(2.5rem, 3.5vw, 3.35rem)"
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: "-0.055em"
  display:
    fontFamily: '"League Gothic", "Arial Narrow", sans-serif'
    fontSize: "clamp(3.15rem, 5.8vw, 5rem)"
    fontWeight: 400
    lineHeight: 0.82
    letterSpacing: "0.005em"
  displayCjk:
    fontFamily: '"Noto Sans CJK SC Index", "PingFang SC", sans-serif'
    fontSize: "4rem"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"League Gothic", "Arial Narrow", sans-serif'
    fontSize: "clamp(2.35rem, 4vw, 3.25rem)"
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: '"IBM Plex Mono", monospace'
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.04em"
  action:
    fontFamily: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.2
  count:
    fontFamily: '"IBM Plex Mono", monospace'
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.2
  detailHeadline:
    fontFamily: '"Iowan Old Style", "Times New Roman", "Songti SC", STSong, SimSun, serif'
    fontSize: "clamp(3.8rem, 6.6vw, 5.35rem)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  detailReading:
    fontFamily: '"Iowan Old Style", "Times New Roman", "Songti SC", STSong, SimSun, serif'
    fontSize: "0.98rem"
    fontWeight: 400
    lineHeight: 1.78
rounded:
  stamp: "2px"
  control: "3px"
  sleeve: "4px"
  crate: "5px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "32px"
components:
  search-slot:
    backgroundColor: "rgba(17, 19, 19, 0.88)"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "52px"
  sleeve:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sleeve}"
  rating-top:
    backgroundColor: "{colors.acid}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stamp}"
    padding: "2px 8px"
    height: "24px"
  language-switch:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "10px 12px"
---

# Design System: Ktoon’s Index

## Overview

**Creative North Star: "Crate Index / Continuous Sleeves"**

The shipped homepage turns a personal AI index into one continuous stack of cool-paper sleeves inside a matte graphite crate. The record-archive metaphor is structural rather than illustrative: fixed dividers, catalog codes, track rows, restrained grooves, and physical contact edges support fast scanning without a hero, marketing layer, or card grid. This is the implementation of direction contract `FORM seed ccfbb7c7`.

The system feels tactile but not nostalgic. Two self-hosted, seamless 1600×1600 WebP materials—`assets/graphite-grain.webp` and `assets/paper-grain.webp`—supply low-contrast substrate; CSS owns all edges, tabs, grooves, shadows, and interaction. No copy, icons, borders, or lighting are baked into raster assets.

**Key Characteristics:**

- One graphite frame, one continuous single-column paper stack, five fixed categories.
- Editorial serif for the personal wordmark, condensed display for category identity, neutral sans for reading, and mono only for real catalog metadata.
- Acid green is a scarce state signal, not a decorative field.
- Physicality comes from material, overlapping edges, contact shadow, and restrained vertical feedback.

## Colors

Near-black graphite and cold paper carry almost the entire surface; metal and muted text organize hierarchy, while acid green marks the strongest judgment and active state.

### Primary

- **Acid Signal:** Reserved for the `夯` rating, active-language label, focus ring, brand bars, skip link, and hover locator.

### Neutral

- **Graphite:** Page background and masthead substrate.
- **Crate Black:** Slightly raised crate body.
- **Cool Paper:** Sleeves and search-results layer.
- **Paper Ink:** Primary text on paper.
- **Metal:** Secondary structural information.
- **Muted Light / Muted Ink:** Secondary copy on graphite / paper respectively.
- **Paper Line:** Hairline row and panel separation on paper.

**The Scarce Signal Rule.** Acid green identifies location, focus, or highest judgment; never use it as a large decorative fill.

**The Material Contrast Rule.** Preserve readable graphite-on-paper and paper-on-graphite contrast even when texture is present; texture must remain quieter than type.

## Typography

**Brand Font:** Iowan Old Style, with Baskerville / Palatino / Georgia editorial serif fallbacks

**Display Font:** League Gothic, with narrow sans-serif fallback

**Chinese Display Font:** minimal `Noto Sans CJK SC Index` 700 subset, with PingFang SC fallback

**Body/Sans Font:** IBM Plex Sans Condensed 400 / 500, with narrow sans-serif fallback

**Detail Reading Font:** Iowan Old Style, with Times New Roman / Songti SC / STSong / SimSun serif fallbacks

**Label/Mono Font:** IBM Plex Mono, with monospace fallback

The core content families are self-hosted under `assets/fonts/`; typography must not depend on remote font loading. The masthead is a pure-text `Ktoon’s Index` wordmark in the approved editorial system stack: Iowan Old Style first, then Baskerville, Palatino-compatible faces, and Georgia. This deliberate system stack aligns the identity with the printed dossier while retaining robust local fallbacks. The possessive `’s` uses the same family in muted italic, never a second display face. League Gothic remains responsible for English category names and compact index headings. Chinese category labels use a tiny, category-only Noto Sans CJK SC subset at native proportions. IBM Plex Sans Condensed carries homepage titles, descriptions, search, brand descriptor, and footer copy. IBM Plex Mono is reserved for counts and catalog metadata.

The detail dossier extends the masthead's editorial voice into the printed record. Iowan Old Style with Times New Roman and Songti-compatible fallbacks carries the record headline, editorial section headings, personal evaluation, and supporting explanatory copy. IBM Plex Sans Condensed carries the deck, return/primary actions, and reference titles. IBM Plex Mono carries folio, dates, IDs, labels, counts, indexes, and hosts. The minimal Noto Sans CJK subset appears only in the acid rating grade character on this surface.

### Hierarchy

- **Display:** Uppercase category names only; the fluid desktop scale is normative, with mobile overrides preserving prominence without clipping.
- **Brand:** `Ktoon’s Index` in the approved editorial serif stack; the gray italic possessive is a subordinate inflection inside one family.
- **Headline:** Compact English index headings in League Gothic.
- **Title:** Entry titles at medium weight, allowed up to two lines on desktop without becoming a continuous black band.
- **Body:** Entry descriptions and result summaries; desktop sleeve descriptions stay on one line, then wrap on narrow layouts.
- **Label:** Counts, codes, legends, footer metadata, and language controls. Use tabular-looking mono only where the content behaves like data.
- **Detail Headline / Reading:** Iowan Old Style with Times New Roman and Songti-compatible serif fallbacks provides the newspaper voice for the dossier headline and authored judgment; sans remains responsible for orientation and action.

**The Role Discipline Rule.** Editorial serif names the personal archive and carries the printed detail record, condensed display labels categories, condensed sans orients and acts, and mono records metadata; do not swap their roles for decoration.

### Type Scale

- **Micro metadata — 11px:** catalog codes, legends, brand descriptor, and footer metadata.
- **Labels — 12px:** ratings, language control, counts inside overlays, and “view all” actions.
- **Descriptions — 13px:** entry descriptions and search-result summaries.
- **Mobile titles — 15px:** entry titles at the narrowest breakpoint.
- **Titles — 15px / 500:** desktop and mobile entry titles.
- **Counts — 18px desktop / 14px mobile:** category totals paired with display headings.
- **Brand — 40-53.6px desktop / 28px tablet / 24px mobile:** one unbroken line; the search slot and language switch retain independent width.
- **Display:** English category headings remain fluid up to 80px; Chinese category headings use 64px desktop and 52px mobile without geometric scaling.

## Layout

The document is at least one dynamic viewport tall. The masthead stays at the top and the footer at the bottom; only the crate is vertically centered in the flexible space between them. When the content is taller than the viewport, the middle row grows naturally so scrolling never hides the masthead or first sleeve.

The homepage is a single column, capped at 1560px for the crate and 1480px for masthead/footer content. Above 820px each sleeve uses an approximately 30.5/69.5 split: category identity and count on the left, three aligned track rows on the right. Desktop sleeves target a compact 134px minimum height: three 40px track links sit inside 6px vertical list padding, while the catalog code and “view all” action share one compact metadata row beneath the title. At 820px that row returns to a vertical flow to preserve narrow-screen reading order. Adjacent sleeves overlap by 7px to read as a continuous physical stack. Every sleeve shares the same left and right top-edge datum, so the first and final sleeve begin at exactly the same horizontal coordinates. The micro-taper remains local to each paper surface and never accumulates through the stack.

At 1080px the identity rail compresses to 250px. At 820px the masthead uses a 28px single-line brand wordmark, each sleeve becomes one column, and identity moves above its tracks while the paper stack remains continuously edge-to-edge with no exposed graphite gap. Mobile sleeves keep the same shared outer datum while the local taper reduces to 2px per side at rest and 1px per side when lifted. At 520px the brand wordmark becomes 24px, secondary brand copy and the catalog code disappear, and titles and descriptions wrap rather than truncate. The minimum supported viewport is 320px.

Keep the first-release category sequence fixed: Toolkit, Products, Articles, Standards, Ideas. Every sleeve shows its total count and exactly the highest-rated three eligible entries; unrated entries never fill a homepage Top 3 slot.

## Elevation & Depth

Depth is structural and directional: the graphite crate has inset rim/base shading, paper sleeves have stronger downward contact shadows, and the search result layer lifts above the masthead. Each sleeve also carries a bright left paper edge, a restrained dark right edge, a concealed paper tail, and an integrated cut-tab highlight. The paper and graphite rasters stay flat; CSS supplies edges and lighting. There are no gradients, glass effects, neon glows, or hard offset shadows.

### Shadow Vocabulary

- **Paper Contact:** `0 18px 30px rgba(0, 0, 0, 0.42), 0 5px 10px rgba(0, 0, 0, 0.3)`; used by every sleeve.
- **Raised Tab Cast:** never use `filter`, duplicate the full tab silhouette, draw parallel polygon strips, or expose the shadow carrier itself. A transparent 3×13px rounded carrier is recessed 12px left and 1px upward beneath the paper shoulder, so the sloped turn masks its upper-left portion. Three increasingly low-opacity shadows extend 2px, 4px, and 8px downward, producing a longer soft tail without outlining the carrier.
- **Track Lift:** `0 5px 12px rgba(23, 25, 24, 0.12)`; appears only on hover or focus-within.
- **Result Overlay:** `0 24px 52px rgba(0, 0, 0, 0.48), 0 3px 8px rgba(0, 0, 0, 0.28)`; reserved for the transient search layer.

**The CSS Owns the Edge Rule.** Raster assets provide substrate only; never bake corners, shadows, highlights, geometry, copy, or icons into material images.

## Shapes

The form language is mostly rectangular: 2px rating stamps, 3px controls and overlays, 4–5px sleeves, and a 5px crate. Sleeve tabs are cut from the full left edge: one flat raised shoulder drops through a short, rounded 9×15px turn into the lower page edge, matching the compact step of a physical file divider rather than a long diagonal fold or floating tab. The turn is defined by a multi-point paper silhouette and its own contact shadow; never draw an independent dark stroke or blurred corner patch. Later sleeves sit above earlier sleeves so each following tab remains visible and appears to rise out of the stack. The 999px radius is limited to compact controls such as language and clear actions. Structural separators are 1px; authored SVG/CSS groove lines are thinner and decorative only.

## Components

### Search Slot

- A real search form/input sits in the masthead at a minimum height of 52px. Focus-within changes its border to acid green.
- Querying opens a paper result layer with result count and empty state. Search matches title and description strings only, ordered exact title → title contains → description contains.
- The clear button appears only for a non-empty query; Escape clears, submit focuses the first result, and outside click closes the layer without changing the query.

### Continuous Sleeve

- Each semantic section has a paper texture, staggered top tab, contact shadow, category identity, total count, catalog code, “view all” link, and an ordered three-row track list.
- The paper surface is an independent clipped layer. At rest its top edge is 8px wider than its bottom edge on desktop and 4px wider on mobile. During lift the taper relaxes to 2px per side on desktop and 1px per side on mobile. The semantic section and its content are never skewed or perspective-transformed. The concealed tail follows the same taper state, while every sleeve wrapper retains an identical full-width top datum.
- The sleeve stack and raster tray must share one `.sleeve-stage` coordinate system. The stage boundary is the paper boundary; the tray extends exactly 18px beyond it per side, while its repeating center begins and ends exactly on the stage boundary. Fixed 40×39px caps cover those center endpoints. The tray top sits 19px above the stage bottom because that is the cap asset's internal top-lip offset, placing the 20px center face exactly at the paper bottom. These relationships never depend on viewport or crate width.
- All three tray assets are authored at final CSS pixel size and are never browser-scaled: 40×39px caps and an 80×20px mirrored center tile. Their top lip, face start, and bottom edge share one target pixel baseline; the cap intersection columns are color-matched to the center tile. End caps contain only tray material and alpha, never paper pixels or page background.
- Desktop track rows align rating, title, and one-line description. At 820px they become two-column/two-line rows without adding a divider below the identity block; at 520px long titles are not clamped.
- The initial settle motion runs for 620ms with `cubic-bezier(0.16, 1, 0.3, 1)` and a 55ms per-sleeve stagger. Content is visible from the start; reduced-motion collapses animations and transitions to effectively zero duration.
- On fine-pointer hover or keyboard focus-within, the entire sleeve moves exactly 6px upward with no horizontal translation or scaling. A permanent 6px paper-textured tail extends below every sleeve; later sleeves hide it at rest, while it fills the vacated bottom area during lift. The lifted sleeve keeps its original stack order rather than jumping above all siblings, so the following sleeve's shoulder, boundary, and contact shadow remain visible over the tail. The lifted sleeve itself removes all exterior shadow. Entry takes 340ms and release takes 220ms with the existing exponential ease-out. Touch layouts do not trigger the lift, and reduced-motion removes the transform entirely.
- A lifted sleeve owns a dedicated top-contact shadow layer beginning at the end of its raised tab and continuing across the horizontal top edge. It casts only upward onto the preceding sleeve during lift; it must not restore a full wrapper shadow, modify the following sleeve, or change sibling z-index. Mouse hover and keyboard focus-within must produce the same shadow state.

### Detail Dossier

- A detail page is one complete cold-paper newspaper record opened inside the existing graphite crate, never a blog article, attribute dashboard, or collection of cards. The shared masthead, search, language switch, material textures, type roles, and scarce acid signal remain unchanged from the homepage world.
- Above 820px the dossier is a landscape printed record. Its compressed folio is 40px tall with 18px horizontal padding: archive data uses 9px IBM Plex Mono, while the return entry uses 10px mono with a typographic short arrow. One full-width headline band follows, pairing a restrained newspaper title and deck with a compact editorial rating mark. Below it, a lightly tinted metadata column sits beside the reading field; the field flows through a two-column personal note, one primary source, and a three-column reference index. The dossier targets a 650px minimum height without manufacturing body copy to fill it.
- The graphite crate must remain visibly present around all four paper edges. Its upper groove and lower lip share the paper coordinate system and create a dark reading-table surround rather than a generic card frame. The paper reuses the exact homepage cold-paper color and grain, with a bright left/top fiber edge, a restrained right edge, a darker bottom contact edge, and the homepage's two-stage contact-shadow logic.
- The main paper sheet fills the dossier at `inset: 0` and presents one complete surface with softly rounded left corners and an integrated upper-right index extension. The return-to-category link belongs in the folio's normal document flow. The extension belongs to the same paper layer as the sheet: it overlaps the sheet by 28px and covers the sheet's right edge at the connection, so no border or cast shadow can appear between extension and paper. On desktop it exposes only 14px and continues from the paper's top edge through one long vertical plane before a single cubic acute shoulder returns to the normal right edge. It must never use mirrored upper/lower shoulders or resemble a shield-shaped ear. Mobile uses the same one-shoulder construction with only 7px exposure. Every visible content region remains above the unified paper silhouette.
- The rating is one unboxed Chinese grade character set in the detail reading serif. It has no background, border, rules, edition copy, or explanatory label; the accessible name carries the rating meaning. Acid is therefore reserved for the primary-source strip on the detail surface.
- Every detail-dossier rule is a single solid stroke. Use 1px for hairlines and row separation, 2px for secondary section/action boundaries, and 4px for the strongest editorial divisions. Double borders are prohibited on this surface; hierarchy comes from stroke weight, spacing, and typography instead.
- The detail headline and authored reading text use `Iowan Old Style` with `Times New Roman`, Songti, STSong, and SimSun fallbacks. This tighter newsprint serif is reserved for the printed record; condensed sans still owns deck/action copy and mono still owns navigation and archive data. The personal evaluation uses two balanced columns, a fine column rule, and justified CJK-capable composition. It does not use a drop cap: the single-character rating is the only oversized Chinese mark on the sheet and must retain the stronger editorial priority. Supporting materials end the page as a numbered three-column index with quiet paper rows and hairline dividers.
- At 820px and below, the dossier becomes a single reading column in the fixed order folio, headline/rating, metadata, judgment, primary source, references. The metadata rail becomes a horizontal band, the personal note returns to one column and left alignment, and the reference index stacks. The graphite lip remains visible, while the right index slip becomes smaller rather than disappearing.
- Detail motion stays at intensity 3: paper and content are static, while links change only ink, underline, or paper brightness. The dossier does not animate on load or hover; reduced-motion rules remain present as a safety fallback.
- The page ends with the reference ledger. It carries no copied source body, table of contents, recommendations, previous/next navigation, social controls, or editing controls.

### Track Row and Rating Stamp

- Hover or focus-within shifts a track 4px, draws an 18px acid locator line, and adds a soft lift. Keyboard focus remains a 2px acid outline with 4px offset.
- `夯` uses acid fill, `人上人` uses a lighter neutral fill, and `NPC` uses the base neutral stamp. The visible legend preserves the public ordering `夯 > 人上人 > NPC`.

### Language Switch

- The mono pill toggles only interface labels, category names, controls, prompts, ARIA labels, and document language between Chinese and English.
- Entry titles and descriptions remain exactly in their recorded language; no translated content duplicate is implied.

### Content and Safety Boundary

- The public page is read-only. Rendered mutable text is HTML-escaped; content links accept only safe in-page anchors or HTTPS and otherwise fall back to `#main-content`.
- Search never reads body copy, tags, ratings, or categories. The public surface exposes no authoring, login, voting, likes, comments, analytics, recommendations, or destructive Agent controls.
- The current arrays, counts, links, and entry copy in `app.js` are demo content. Several `#...` links and every “view all” query are placeholders; category/detail pages, persistence, production search indexing, and Agent maintenance APIs are not delivered by this homepage.

## Do's and Don'ts

### Do:

- **Do** preserve Continuous Sleeves, the five-category order, single-column reading flow, and the left/right-to-stacked responsive transformation.
- **Do** use the two material WebPs only as quiet repeating substrates and keep all interactive geometry semantic and CSS-authored.
- **Do** keep focus visible, motion optional, long mobile copy readable, and interface-only localization explicit.
- **Do** label demo data and placeholder destinations honestly until real content and routes replace them.

### Don't:

- **Don't** add a hero, marketing claims, recommendations, popularity modules, bento/card grids, or growth-oriented controls.
- **Don't** literalize the metaphor with records, stylus hardware, album art, cover walls, perspective scenes, or rasterized interface copy.
- **Don't** use gradients, glass, neon glow, serif “digital garden” styling, generic glyph icons, remote display fonts, or system faces outside the approved brand/detail serif stacks.
- **Don't** translate user-authored entry content when the interface language changes, broaden search beyond title/description, or treat demo links and counts as production data.
