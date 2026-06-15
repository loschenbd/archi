# Archi Design System — "Paper Layer"

**Status:** Spec — pending user review before plan
**Date:** 2026-06-15
**Author:** Ben Loschen (with Claude)

## 1. Goal

Unify Archi's visual language under one small, named system. Today the four shipped surfaces — Home, Library, Chat, Settings — use three different input styles, three card treatments, six button shapes, and inconsistent typography. The system below replaces those ad-hoc styles with a fixed set of primitives that lean into a **literary, paper-and-ink** aesthetic: warm hairlines, subtle paper grain, Newsreader serif for titles and passages, wax-red used as a punctuation mark.

Non-goal: re-skin into a heavy skeumorphic theme. Texture and decoration are subtle; the app remains a fast, modern productivity tool.

## 2. Scope

In-scope screens & shells:

- Home (hero search, suggestions, random highlight)
- Library (tabs, search + filter row, passage list, book detail)
- Chat (status badge, transcript, composer, setup screen, model picker)
- Settings (tabs, connection cards, search index card)
- Onboarding wizard (5 steps)
- Modals (support prompt, future dialogs)
- Sidebar shell

Out of scope (this pass):

- Marketing site (`apps/marketing/`)
- Any feature work — this is pure visual unification

## 3. Foundations (tokens)

### 3.1 Color (additions only — existing palette retained)

```css
:root {
  /* Warm rules — replace ink-300/40 grey hairlines */
  --rule-warm: color-mix(in srgb, var(--ink-700) 28%, transparent);
  --rule-warm-strong: color-mix(in srgb, var(--ink-700) 50%, transparent);

  /* Ink shades for chrome */
  --ink-warm: color-mix(in srgb, var(--ink-700) 70%, #6b4a32); /* eyebrows, footnotes */

  /* Wax-seal red — used sparingly */
  --wax-red: var(--accent-strong);
  --wax-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18);

  /* Paper background atmosphere */
  --paper-warm-bg:
    radial-gradient(
      120% 90% at 50% 0%,
      color-mix(in srgb, var(--paper-50) 96%, #fff) 0%,
      var(--paper-100) 60%,
      color-mix(in srgb, var(--paper-100) 88%, #d9c8b6) 100%
    );

  /* Subtle paper grain (SVG noise data-url) */
  --paper-grain: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.16  0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
```

Greys (`ink-300`, etc.) remain for text muting; chrome borders move to `--rule-warm`.

### 3.2 Radius

```css
--radius-line: 0;
--radius-control: 4px; /* inputs, buttons, selects */
--radius-card: 10px;
--radius-modal: 14px;
--radius-pill: 999px; /* chips, badges */
```

### 3.3 Shadow

```css
--shadow-hairline: inset 0 0 0 1px var(--rule-warm);
--shadow-card:
  0 4px 14px -8px rgba(72, 53, 41, 0.18),
  inset 0 1px 0 rgba(255, 255, 255, 0.5);
--shadow-raised: 0 12px 32px -12px rgba(72, 53, 41, 0.32);
--shadow-focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 26%, transparent);
```

### 3.4 Typography roles

- **Newsreader (serif)** — screen titles, card titles, quoted passages, citation footnote numbers. Nothing else.
- **Inter / system sans** — body, labels, buttons, inputs, chips, captions, sidebar nav.
- **JetBrains Mono** — counts, keyboard hints (⌘K), code snippets. Removed from citation pills.

### 3.5 Type ramp

| Token              | Spec                                                          | Use                                 |
| ------------------ | ------------------------------------------------------------- | ----------------------------------- |
| `--type-display`   | 28px / 1.15 / Newsreader / 600                                | Screen titles when rendered         |
| `--type-card-title`| 20px / 1.2 / Newsreader / 600                                 | Card headlines                      |
| `--type-eyebrow`   | 11px / 1 / 600 / 0.18em / small-caps / `--ink-warm`           | Section labels                      |
| `--type-quote`     | 18px / 1.55 / Newsreader / 400, italic option                 | Passage quotes                      |
| `--type-body`      | 14.5px / 1.55 / Inter / `--ink-700`                           | Default body                        |
| `--type-label`     | 12.5px / 1.4 / Inter / 500 / `--ink-700`                      | Form labels                         |
| `--type-button`    | 13px / 1.1 / Inter / 600                                      | Button text                         |
| `--type-caption`   | 12px / 1.4 / Inter / `--ink-500`                              | Captions, helper text               |
| `--type-mono-pill` | 10.5px / 1 / JetBrains Mono / 600                             | Counts, ⌘K hint                     |

## 4. Components

### 4.1 `.ui-card`

The only card primitive. Replaces `.screen-card`, `.connection-card`, `.search-result-card` (outer frame), Settings cards, onboarding step cards, random-highlight panel, citation list rows.

```css
.ui-card {
  background: var(--paper-warm-bg), var(--paper-grain);
  background-blend-mode: multiply;
  border: 1px solid var(--rule-warm);
  border-radius: var(--radius-card);
  padding: var(--card-pad, 24px);
  box-shadow: var(--shadow-card);
}
.ui-card--tight { --card-pad: 16px; }
.ui-card--loose { --card-pad: 32px; }
.ui-card--ruled {
  /* Doubled inset rule — printed-page-border look */
  box-shadow:
    var(--shadow-card),
    inset 0 0 0 1px var(--rule-warm),
    inset 0 0 0 4px transparent,
    inset 0 0 0 5px var(--rule-warm);
  padding: calc(var(--card-pad, 24px) + 6px);
}
```

Slot conventions:

- `.ui-card__eyebrow` — small-caps section label (uses `--type-eyebrow`)
- `.ui-card__title` — Newsreader headline with a 1px `--rule-warm` bottom rule, 8px below the line
- `.ui-card__body` — body text
- `.ui-card__footer` — right-aligned ghost buttons

### 4.2 Fields — rectangular, hairline

```css
.ui-input,
.ui-textarea,
.ui-select {
  background: color-mix(in srgb, var(--surface) 96%, #fff);
  border: 1px solid var(--rule-warm);
  border-radius: var(--radius-control);
  padding: 12px 14px;
  font: var(--type-body);
  color: var(--ink-900);
  outline: none;
  transition: border-color 120ms ease, box-shadow 160ms ease;
}
.ui-input:focus,
.ui-textarea:focus,
.ui-select:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus-ring);
}
.ui-input::placeholder { color: var(--ink-500); }

.ui-input--lg {
  padding: 18px 22px;
  font-size: 18px;
}
```

`.ui-select` uses a CSS-mask chevron to keep visual parity with `.ui-input`.

### 4.3 Buttons — rectangular, hairline

```css
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: var(--radius-control);
  font: var(--type-button);
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, transform 100ms ease;
}
.ui-btn:focus-visible { box-shadow: var(--shadow-focus-ring); }

.ui-btn--primary {
  /* Wax-seal feel: pressed and slightly lit */
  background: linear-gradient(180deg, var(--accent-500) 0%, var(--accent-strong) 100%);
  color: #fff;
  border: 1px solid color-mix(in srgb, var(--accent) 56%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    0 4px 10px -6px rgba(178, 63, 47, 0.45);
}
.ui-btn--secondary {
  background: color-mix(in srgb, var(--surface) 96%, #fff);
  border: 1px solid var(--rule-warm);
  color: var(--ink-700);
}
.ui-btn--secondary:hover {
  border-color: var(--rule-warm-strong);
  background: color-mix(in srgb, var(--accent-soft) 22%, var(--surface));
}
.ui-btn--ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink-500);
  padding: 6px 10px;
}
.ui-btn--ghost:hover { color: var(--accent-strong); }

.ui-btn--danger {
  background: color-mix(in srgb, var(--surface) 96%, #fff);
  border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--rule-warm));
  color: var(--accent-strong);
}
.ui-btn--danger:hover {
  background: color-mix(in srgb, var(--accent-soft) 32%, var(--surface));
}
```

Size variants: `.ui-btn--sm` (8px y / 14px x, 12.5px text), `.ui-btn--lg` (14px y / 22px x, 14px text).

### 4.4 Chips & Badges — pills

Chips read as *tags*; badges read as *status*. Both stay pill-shaped to contrast with rectangular actions.

```css
.ui-chip {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  font: var(--type-label);
  background: color-mix(in srgb, var(--ink-300) 18%, transparent);
  border: 1px solid var(--rule-warm);
  border-radius: var(--radius-pill);
  color: var(--ink-700);
  cursor: pointer;
}
.ui-chip[aria-selected="true"],
.ui-chip--active {
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 38%, var(--rule-warm));
  color: var(--accent-strong);
}

.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-pill);
}
.ui-badge--ok { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); border: 1px solid color-mix(in srgb, var(--success) 38%, transparent); }
.ui-badge--warn { background: color-mix(in srgb, #c0962d 18%, transparent); color: #8a6a17; border: 1px solid color-mix(in srgb, #c0962d 42%, transparent); }
.ui-badge--info { background: color-mix(in srgb, var(--accent-soft) 55%, transparent); color: var(--accent-strong); border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); }
.ui-badge--neutral { background: color-mix(in srgb, var(--ink-300) 20%, transparent); color: var(--ink-500); border: 1px solid var(--rule-warm); }
```

### 4.5 Tabs — underline

```css
.ui-tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--rule-warm);
}
.ui-tab {
  position: relative;
  padding: 10px 4px;
  font: var(--type-button);
  color: var(--ink-500);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.ui-tab[aria-selected="true"] {
  color: var(--ink-900);
}
.ui-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset: auto 0 -1px 0;
  height: 2px;
  background: var(--accent-strong);
}
```

### 4.6 Dividers & decorations

- `.ui-hr` — 1px `--rule-warm` horizontal rule
- `.ui-rule-strong` — 1px `--rule-warm-strong` rule under section eyebrows
- `.ui-fleuron::before { content: "❦"; }` — used in empty states and "New chat" reset divider
- `.ui-drop-cap::first-letter` — 52px Newsreader, `--accent-strong`, float left with 0.86 line-height — applied opt-in to passage card quotes on Home random highlight and book detail intro only

### 4.7 Wax-seal marker

Sidebar active state and any single-purpose seal accent:

```css
.ui-wax-mark {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--wax-red) 92%, #fff) 0%, var(--wax-red) 60%, color-mix(in srgb, var(--wax-red) 70%, #000) 100%);
  box-shadow: var(--wax-shadow), 0 0 0 1px color-mix(in srgb, var(--wax-red) 50%, transparent);
}
```

### 4.8 Citation footnote

Replaces the current `.chat-citation-ref` monospace pill.

```css
.ui-footnote-ref {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-family: Newsreader, Georgia, serif;
  font-style: italic;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-strong);
  background: transparent;
  border: 1px solid var(--rule-warm);
  border-radius: 999px; /* circle */
  vertical-align: super;
  line-height: 1;
  cursor: pointer;
}
.ui-footnote-ref:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 60%, transparent); }
```

Footnote refs in answer text render the *number itself* in italic Newsreader (e.g. ¹), not `[1]`.

## 5. Atmosphere

### 5.1 App background

```css
body {
  background: var(--paper-warm-bg);
}
body::before {
  /* Grain overlay — pointer-events none */
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: var(--paper-grain);
  background-size: 160px 160px;
  opacity: 0.5; /* multiplied with 6% noise alpha = effective ~3% */
  z-index: 0;
}
```

The grain is applied at the document level so cards, modals, and empty space all share the same fiber. Cards do **not** double-stamp the grain.

### 5.2 Sidebar

- Background: paper gradient with a faint right-edge `--rule-warm` vertical rule (1px).
- Nav buttons: no background highlight. Active item gets a `.ui-wax-mark` positioned absolutely on the left edge (centered vertically), 6px from the edge of the sidebar.
- Sidebar divider stays as a `--rule-warm` 1px line, but fades at both ends via `mask: linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)` — deckle-edge effect.
- Logo retains current treatment.

## 6. Application per screen

### 6.1 Home

- Hero search: `.ui-input--lg`. Magnifier icon stays.
- Suggestion row: `.ui-chip` × 4 ("books on creativity", etc.). Recent searches stay as inline links.
- "A RANDOM HIGHLIGHT" panel: `.ui-card--ruled` with `.ui-card__eyebrow` + `.ui-drop-cap` Newsreader quote + ghost Shuffle button.

### 6.2 Library

- Tabs: `.ui-tabs` (underline) with "By book" / "All highlights".
- Search row: `.ui-input` + `.ui-select`. Both 40px tall.
- "3135 passages" count: `.ui-caption`.
- Passage rows: `.ui-card--tight`. Quote uses `--type-quote` Newsreader. Footer = "— Throne Room Company" italic + `.ui-btn--ghost` "Open book" + `.ui-btn--ghost` "Copy", separated by a single `--rule-warm` divider.
- Currently-selected passage gets a `.ui-card__active` accent border tint.

### 6.3 Chat

- Header row: `.ui-badge--info` "Local · Ollama (llama3.1:8b)" + `.ui-btn--secondary` "New chat".
- Empty-state hint: italic Newsreader, replaces the current `chat-screen-empty-hint`.
- Composer: `.ui-textarea` (replaces nested `chat-input` shell) with `.ui-btn--primary` Send / `.ui-btn--secondary` Stop in a single row below.
- Transcript:
  - User bubble: `.ui-card--tight` with accent wax-red fill, white text. (One exception to the "no accent fills" rule — it's the user's voice, marked clearly.)
  - Assistant bubble: `.ui-card--tight` with the paper-grain background.
  - Citation footnotes: `.ui-footnote-ref` (italic Newsreader number in a circle).
  - Sources panel: `.ui-card__eyebrow` "Sources" + list of `.ui-card--tight` citation cards.

### 6.4 Settings

- Top tabs (Connections / Logs / Search): `.ui-tabs` (underline). Replaces current colored pill tabs.
- Each integration is a `.ui-card`:
  - Title row: `.ui-card__title` (Newsreader) + `.ui-badge` (`--ok` / `--warn` / `--neutral`).
  - Body: status text.
  - Form fields: `.ui-input`.
  - Action row: `.ui-btn--secondary` for Connect, Reconnect, Test, Refresh, Update token. `.ui-btn--danger` for Disconnect. Diagnostics expander stays.
- Search index card: same `.ui-card`. Stats use `.ui-card__eyebrow` for each label ("INDEX STATUS", "RUNTIME", "EMBEDDING MODEL") with body text below.

### 6.5 Book detail

- Header (back chevron + Newsreader title + author subtitle) stays.
- Outer frame: `.ui-card--ruled`.
- Passage list inside reuses Library's `.ui-card--tight` rows.

### 6.6 Onboarding wizard

- Step shell: `.ui-card--ruled` on the existing `.onboarding-layout`.
- Title: `.ui-card__title` Newsreader. Helper copy: `--type-body` ink-700.
- Inputs: `.ui-input`. Primary CTA: `.ui-btn--primary`. Secondary: `.ui-btn--secondary`.
- Step progress indicator stays but reuses `--rule-warm` for inactive segments and `--accent-strong` for completed.

### 6.7 Modals

- Modal surface: `.ui-modal` with `--radius-modal` + `--shadow-raised` + paper-grain.
- Action row reuses standard buttons.
- Support prompt modal — no functional change, just adopt the system.

## 7. Code organization

New file: `apps/desktop/src/renderer/styles/design-system.css`

Loaded **after** `styles.css` from the renderer entrypoint. Holds all `.ui-*` classes and the token additions. Keeping it separate makes it possible to land the foundations + components without deleting the legacy classes in the same PR — screens migrate one at a time.

Per-screen migration:

1. Land tokens + components (no behavior change, no screen changes).
2. Migrate Home.
3. Migrate Library.
4. Migrate Chat.
5. Migrate Settings.
6. Migrate book detail.
7. Migrate onboarding wizard.
8. Migrate modals.
9. Delete dead legacy classes (`.screen-card`, `.connection-card`, `.chat-input`, etc.) in a final cleanup pass.

Each migration step preserves behavior and types — these are CSS class swaps + small JSX edits to introduce semantic slot elements.

## 8. Accessibility

- All `.ui-btn`, `.ui-input`, `.ui-chip`, `.ui-tab` receive `:focus-visible` ring (`--shadow-focus-ring`) — the ring shape matches the control shape (rectangular ring for buttons/inputs, pill ring for chips/badges).
- Color contrast: ink-700 on paper-50 passes WCAG AA at body sizes. Wax-red CTAs pass AA white-on-accent-strong.
- Reduced motion: no animations are critical; the existing chat-typing/spinner animations remain. Add `@media (prefers-reduced-motion: reduce)` to disable transforms in `.ui-btn--primary` hover.

## 9. Testing strategy

CSS-only; no logic tests. Verification is visual:

- Add a `docs/qa/design-system.md` checklist covering every screen + every component permutation.
- `pnpm -F @archi/desktop typecheck` after each JSX edit.
- Manual smoke on every screen after each migration step.

## 10. Out of scope this pass

- Dark theme. The token additions are dark-theme-friendly but the values above target the light/paper theme only.
- Marketing site refresh.
- Print styles.
- Animation choreography pass (transitions, scroll behaviors).

## 11. Risks & open questions

- **Grain texture performance.** SVG data-url tiled across a fixed pseudo-element is GPU-cheap on macOS Electron; verified on prior Archi screens. Risk: low.
- **`color-mix` browser support.** Electron's Chromium is current; supported. No issue.
- **Doubled inset rule visual conflict.** Only on `.ui-card--ruled`; avoid stacking with `.ui-card__title` rule on the same card.
- **Drop cap interplay with truncation.** Drop cap renders before the truncated quote — verified by browser line-clamp; if it conflicts, fall back to no drop cap on truncated cards.

## 12. References

- Reference image shared by user: "New Regent Quill" font promo — for paper / wax-seal / warm hairline cues. Type direction is **not** New Regent Quill; we stay on Newsreader.
- Existing Archi tokens: `apps/desktop/src/renderer/styles.css` `:root` block.

---

**Next step after user review:** Generate `docs/superpowers/plans/2026-06-15-design-system.md` with task-by-task migration plan, then execute via subagent-driven development.
