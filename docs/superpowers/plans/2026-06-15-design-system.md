# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roll out the "Paper Layer" design system from `docs/superpowers/specs/2026-06-15-design-system-design.md` across every Archi desktop screen so cards, inputs, buttons, and typography are unified.

**Architecture:** Land foundations + components first in a new `design-system.css` that *adds* `.ui-*` classes without changing any legacy class — a no-op visual diff. Then migrate one screen at a time by swapping legacy classes (`.screen-card`, `.connection-card`, `.chat-input`, etc.) for the new primitives. Each migration is JSX class swaps + small structural edits; no logic changes. Final task deletes the orphaned legacy classes from `styles.css`.

**Tech Stack:** Plain CSS (no Tailwind, no CSS-in-JS); React + TypeScript renderer; Electron host. Verification = `pnpm -F @archi/desktop typecheck` + visual smoke on each screen.

**Reference spec:** `docs/superpowers/specs/2026-06-15-design-system-design.md` (commit `dcf5bdb`).

---

## File map

**New files**
- `apps/desktop/src/renderer/styles/design-system.css` — all `.ui-*` classes + token additions
- `apps/desktop/src/renderer/styles/design-system-tokens.css` — color/radius/shadow/type tokens only (imported first)

**Modified files (foundations phase)**
- `apps/desktop/src/renderer/main.tsx` — add imports of the two new CSS files
- `apps/desktop/src/renderer/styles.css` — add `body::before` grain overlay + sidebar wax-mark hookup; otherwise unchanged in foundations phase

**Modified files (migration phase)**
- `apps/desktop/src/renderer/App.tsx` — sidebar active state markup
- `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- `apps/desktop/src/renderer/screens/home/SearchHero.tsx`
- `apps/desktop/src/renderer/screens/home/RandomHighlight.tsx`
- `apps/desktop/src/renderer/screens/LibraryScreen.tsx`
- `apps/desktop/src/renderer/screens/library/LibraryAllHighlights.tsx`
- `apps/desktop/src/renderer/components/SearchResultCard.tsx`
- `apps/desktop/src/renderer/components/SearchFilterChips.tsx`
- `apps/desktop/src/renderer/screens/ChatScreen.tsx`
- `apps/desktop/src/renderer/screens/ChatSetupScreen.tsx`
- `apps/desktop/src/renderer/components/chat/ChatMessageBubble.tsx`
- `apps/desktop/src/renderer/components/chat/ChatCitationList.tsx`
- `apps/desktop/src/renderer/components/chat/ChatStatusBadge.tsx`
- `apps/desktop/src/renderer/components/chat/ModelPicker.tsx`
- `apps/desktop/src/renderer/components/chat/PullProgressBar.tsx`
- `apps/desktop/src/renderer/screens/SettingsScreen.tsx`
- `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`
- `apps/desktop/src/renderer/screens/SourcesScreen.tsx`
- `apps/desktop/src/renderer/screens/NotionScreen.tsx`
- `apps/desktop/src/renderer/screens/LogsScreen.tsx`
- `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx`
- `apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx`
- `apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx`
- `apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx`
- `apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx`
- `apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx`
- `apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx`
- `apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx`
- `apps/desktop/src/renderer/components/SupportPromptModal.tsx`

**Cleanup**
- `apps/desktop/src/renderer/styles.css` — delete legacy `.screen-card`, `.chat-input`, `.connection-card`, `.search-result-card` outer-frame styles after all screens migrate.

---

## Verification convention used in every task

After each task's edits run **both** of these and confirm clean output:

```bash
pnpm -F @archi/desktop typecheck
```
Expected: command exits 0, no TypeScript errors.

```bash
pnpm dev
```
Expected: Electron window opens, target screen renders without console errors. The dev server is already long-running for this branch — if it's not running, start it; otherwise just `Cmd-R` to reload the renderer after CSS or JSX edits.

QA notes (visual smoke) live in `docs/qa/design-system.md` — Task 1 creates that file.

---

## Phase A — Foundations (CSS-only, no visual change to existing screens)

### Task 1: Scaffold the design-system files + QA checklist

**Files:**
- Create: `apps/desktop/src/renderer/styles/design-system-tokens.css`
- Create: `apps/desktop/src/renderer/styles/design-system.css`
- Create: `docs/qa/design-system.md`
- Modify: `apps/desktop/src/renderer/main.tsx`

- [ ] **Step 1: Create the tokens file with just the design tokens from spec §3**

`apps/desktop/src/renderer/styles/design-system-tokens.css`:
```css
/* ─────────────────────────────────────────────────────────────
   Design System — Tokens (Paper Layer)
   Source: docs/superpowers/specs/2026-06-15-design-system-design.md §3
   ───────────────────────────────────────────────────────────── */

:root {
  /* Warm rules — replace ink-300/40 grey hairlines */
  --rule-warm: color-mix(in srgb, var(--ink-700) 28%, transparent);
  --rule-warm-strong: color-mix(in srgb, var(--ink-700) 50%, transparent);

  /* Ink shades for chrome */
  --ink-warm: color-mix(in srgb, var(--ink-700) 70%, #6b4a32);

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

  /* Radius */
  --radius-line: 0;
  --radius-control: 4px;
  --radius-card: 10px;
  --radius-modal: 14px;
  --radius-pill: 999px;

  /* Shadow */
  --shadow-hairline: inset 0 0 0 1px var(--rule-warm);
  --shadow-card:
    0 4px 14px -8px rgba(72, 53, 41, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  --shadow-raised: 0 12px 32px -12px rgba(72, 53, 41, 0.32);
  --shadow-focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 26%, transparent);
}
```

- [ ] **Step 2: Create the design-system.css file with the section banner only (components added in later tasks)**

`apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ─────────────────────────────────────────────────────────────
   Design System — Components (Paper Layer)
   Source: docs/superpowers/specs/2026-06-15-design-system-design.md §4
   Loaded after styles.css; components are additive — legacy classes
   remain until Task 16 deletes them.
   ───────────────────────────────────────────────────────────── */
```

- [ ] **Step 3: Wire the new files into the renderer entrypoint**

Open `apps/desktop/src/renderer/main.tsx`. Replace the line:
```ts
import "./styles.css";
```
With:
```ts
import "./styles.css";
import "./styles/design-system-tokens.css";
import "./styles/design-system.css";
```
The order matters: legacy styles first (so legacy classes remain authoritative for unmigrated screens), tokens next (so `--rule-warm` etc. exist before any `.ui-*` references), then components.

- [ ] **Step 4: Create the QA checklist file**

`docs/qa/design-system.md`:
```markdown
# Design System — QA Checklist

Reload the renderer (Cmd-R) after each task and verify nothing regressed.

## Foundations phase
- [ ] App launches; no console errors related to CSS variables (`--rule-warm` etc.)
- [ ] No visible change on any screen (foundations are additive only)

## Per-screen migration
For each migrated screen, verify:
- [ ] Cards have warm brown hairline border, paper gradient, soft shadow
- [ ] Inputs are rectangular with warm hairline; focus shows accent ring
- [ ] Primary buttons have wax-seal gradient + pressed feel
- [ ] Secondary buttons are surface-bg with hairline border
- [ ] Pills (chips/badges) keep pill shape; rectangles for fields/actions
- [ ] Newsreader serif on card titles, screen titles, quoted passages
- [ ] Wax-red dot on the active sidebar item only
- [ ] No grey ink-300/40 borders visible on chrome
- [ ] No double-padding (screen-card + screen-internal pad combined)
- [ ] Citation footnotes render as italic Newsreader number in a circle

## Per screen
- [ ] Home — hero search, suggestion chips, random highlight card
- [ ] Library — tabs (underline), search row, passage cards
- [ ] Chat — composer, transcript bubbles, sources panel, status badge
- [ ] Settings — tabs (underline), connection cards, status badges, action buttons
- [ ] Book detail — back chevron, title, passage list inside ruled card
- [ ] Onboarding wizard — each of 5 step screens
- [ ] Modals — Support prompt
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0 with no TypeScript errors. The two new CSS files don't introduce any TS.

- [ ] **Step 6: Verify the renderer loads the new files**

Reload the dev renderer (`Cmd-R` in the Electron window). Open DevTools console. Expected: no errors mentioning the new files or undefined CSS variables.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system-tokens.css \
        apps/desktop/src/renderer/styles/design-system.css \
        apps/desktop/src/renderer/main.tsx \
        docs/qa/design-system.md
git commit -m "design-system: scaffold tokens + components file + QA checklist"
```

---

### Task 2: `.ui-card` family

**Files:**
- Modify: `apps/desktop/src/renderer/styles/design-system.css`

- [ ] **Step 1: Append the card primitives to design-system.css**

Append to `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Cards (spec §4.1) ───── */

.ui-card {
  --card-pad: 24px;
  background: var(--paper-warm-bg);
  border: 1px solid var(--rule-warm);
  border-radius: var(--radius-card);
  padding: var(--card-pad);
  box-shadow: var(--shadow-card);
}

.ui-card--tight { --card-pad: 16px; }
.ui-card--loose { --card-pad: 32px; }

.ui-card--ruled {
  box-shadow:
    var(--shadow-card),
    inset 0 0 0 1px var(--rule-warm),
    inset 0 0 0 4px transparent,
    inset 0 0 0 5px var(--rule-warm);
  padding: calc(var(--card-pad) + 6px);
}

.ui-card__eyebrow {
  display: block;
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-warm);
  margin: 0 0 10px;
}

.ui-card__title {
  font-family: Newsreader, Georgia, serif;
  font-size: 20px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink-900);
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--rule-warm);
}

.ui-card__body {
  font-family: Inter, system-ui, sans-serif;
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ink-700);
}

.ui-card__footer {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: add .ui-card primitives"
```

---

### Task 3: `.ui-input`, `.ui-textarea`, `.ui-select`

**Files:**
- Modify: `apps/desktop/src/renderer/styles/design-system.css`

- [ ] **Step 1: Append the field primitives**

Append to `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Fields (spec §4.2) ───── */

.ui-input,
.ui-textarea,
.ui-select {
  display: block;
  width: 100%;
  background: color-mix(in srgb, var(--surface) 96%, #fff);
  border: 1px solid var(--rule-warm);
  border-radius: var(--radius-control);
  padding: 12px 14px;
  font-family: Inter, system-ui, sans-serif;
  font-size: 14.5px;
  line-height: 1.4;
  color: var(--ink-900);
  outline: none;
  transition:
    border-color 120ms ease,
    box-shadow 160ms ease;
  appearance: none;
}

.ui-textarea {
  resize: vertical;
  min-height: 72px;
  font-family: inherit;
}

.ui-input:hover,
.ui-textarea:hover,
.ui-select:hover {
  border-color: var(--rule-warm-strong);
}

.ui-input:focus,
.ui-textarea:focus,
.ui-select:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus-ring);
}

.ui-input::placeholder,
.ui-textarea::placeholder {
  color: var(--ink-500);
}

.ui-input:disabled,
.ui-textarea:disabled,
.ui-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ui-input--lg {
  padding: 18px 22px;
  font-size: 18px;
}

.ui-select {
  padding-right: 36px;
  background-image: linear-gradient(45deg, transparent 50%, var(--ink-500) 50%),
                    linear-gradient(135deg, var(--ink-500) 50%, transparent 50%);
  background-position:
    calc(100% - 18px) 50%,
    calc(100% - 12px) 50%;
  background-size: 6px 6px;
  background-repeat: no-repeat;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: add .ui-input, .ui-textarea, .ui-select primitives"
```

---

### Task 4: `.ui-btn` family

**Files:**
- Modify: `apps/desktop/src/renderer/styles/design-system.css`

- [ ] **Step 1: Append the button primitives**

Append to `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Buttons (spec §4.3) ───── */

.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.1;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    transform 100ms ease,
    box-shadow 160ms ease;
}

.ui-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.ui-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.ui-btn--primary {
  background: linear-gradient(180deg, var(--accent-500) 0%, var(--accent-strong) 100%);
  color: #fff;
  border-color: color-mix(in srgb, var(--accent) 56%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    0 4px 10px -6px rgba(178, 63, 47, 0.45);
}
.ui-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
}

.ui-btn--secondary {
  background: color-mix(in srgb, var(--surface) 96%, #fff);
  border-color: var(--rule-warm);
  color: var(--ink-700);
}
.ui-btn--secondary:hover:not(:disabled) {
  border-color: var(--rule-warm-strong);
  background: color-mix(in srgb, var(--accent-soft) 22%, var(--surface));
  color: var(--accent-strong);
}

.ui-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--ink-500);
  padding: 6px 10px;
}
.ui-btn--ghost:hover:not(:disabled) {
  color: var(--accent-strong);
}

.ui-btn--danger {
  background: color-mix(in srgb, var(--surface) 96%, #fff);
  border-color: color-mix(in srgb, var(--accent) 38%, var(--rule-warm));
  color: var(--accent-strong);
}
.ui-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-soft) 32%, var(--surface));
}

.ui-btn--sm {
  padding: 8px 14px;
  font-size: 12.5px;
}
.ui-btn--lg {
  padding: 14px 22px;
  font-size: 14px;
}

@media (prefers-reduced-motion: reduce) {
  .ui-btn,
  .ui-btn:hover {
    transform: none;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: add .ui-btn family (primary/secondary/ghost/danger + sizes)"
```

---

### Task 5: `.ui-chip` and `.ui-badge`

**Files:**
- Modify: `apps/desktop/src/renderer/styles/design-system.css`

- [ ] **Step 1: Append chips and badges**

Append to `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Chips & Badges (spec §4.4) ───── */

.ui-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-family: Inter, system-ui, sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  background: color-mix(in srgb, var(--ink-300) 18%, transparent);
  border: 1px solid var(--rule-warm);
  border-radius: var(--radius-pill);
  color: var(--ink-700);
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}
.ui-chip:hover {
  border-color: var(--rule-warm-strong);
  background: color-mix(in srgb, var(--accent-soft) 22%, var(--surface));
  color: var(--accent-strong);
}
.ui-chip[aria-selected="true"],
.ui-chip--active {
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 38%, var(--rule-warm));
  color: var(--accent-strong);
}
.ui-chip:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
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
  border: 1px solid transparent;
}
.ui-badge--ok {
  background: color-mix(in srgb, var(--success) 18%, transparent);
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 38%, transparent);
}
.ui-badge--warn {
  background: color-mix(in srgb, #c0962d 18%, transparent);
  color: #8a6a17;
  border-color: color-mix(in srgb, #c0962d 42%, transparent);
}
.ui-badge--info {
  background: color-mix(in srgb, var(--accent-soft) 55%, transparent);
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 32%, transparent);
}
.ui-badge--neutral {
  background: color-mix(in srgb, var(--ink-300) 20%, transparent);
  color: var(--ink-500);
  border-color: var(--rule-warm);
}

.ui-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: add .ui-chip and .ui-badge primitives"
```

---

### Task 6: `.ui-tabs`, dividers, decorations

**Files:**
- Modify: `apps/desktop/src/renderer/styles/design-system.css`

- [ ] **Step 1: Append tabs, dividers, and decorations**

Append to `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Tabs (spec §4.5) ───── */

.ui-tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--rule-warm);
  margin: 0 0 18px;
}
.ui-tab {
  position: relative;
  padding: 10px 4px;
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--ink-500);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: color 140ms ease;
}
.ui-tab:hover:not([aria-selected="true"]) {
  color: var(--ink-700);
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
.ui-tab:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
  border-radius: 4px;
}

/* ───── Dividers & decorations (spec §4.6) ───── */

.ui-hr {
  height: 1px;
  margin: 0;
  border: 0;
  background: var(--rule-warm);
}
.ui-rule-strong {
  height: 1px;
  margin: 0;
  border: 0;
  background: var(--rule-warm-strong);
}

.ui-fleuron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: Newsreader, Georgia, serif;
  color: var(--ink-warm);
  font-size: 18px;
  line-height: 1;
}
.ui-fleuron::before { content: "❦"; }

.ui-drop-cap::first-letter {
  float: left;
  font-family: Newsreader, Georgia, serif;
  font-size: 52px;
  line-height: 0.86;
  font-weight: 600;
  color: var(--accent-strong);
  padding: 4px 8px 0 0;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: add .ui-tabs, dividers, fleuron, drop-cap"
```

---

### Task 7: `.ui-wax-mark` and `.ui-footnote-ref`

**Files:**
- Modify: `apps/desktop/src/renderer/styles/design-system.css`

- [ ] **Step 1: Append wax marker and footnote reference**

Append to `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Wax-seal marker (spec §4.7) ───── */

.ui-wax-mark {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background:
    radial-gradient(
      circle at 30% 30%,
      color-mix(in srgb, var(--wax-red) 92%, #fff) 0%,
      var(--wax-red) 60%,
      color-mix(in srgb, var(--wax-red) 70%, #000) 100%
    );
  box-shadow:
    var(--wax-shadow),
    0 0 0 1px color-mix(in srgb, var(--wax-red) 50%, transparent);
}

/* ───── Footnote reference (spec §4.8) ───── */

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
  line-height: 1;
  color: var(--accent-strong);
  background: transparent;
  border: 1px solid var(--rule-warm);
  border-radius: 999px;
  vertical-align: super;
  margin: 0 2px;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}
.ui-footnote-ref:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 60%, transparent);
}
.ui-footnote-ref:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

@keyframes ui-footnote-flash {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
    border-color: var(--rule-warm);
  }
  25% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 32%, transparent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
    border-color: var(--rule-warm);
  }
}
.ui-footnote-flash {
  animation: ui-footnote-flash 1.4s ease-out;
  border-radius: 14px;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: add .ui-wax-mark and .ui-footnote-ref"
```

---

### Task 8: Atmosphere — body background + paper grain + sidebar deckle edge

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Locate the body rule in styles.css**

Run: `grep -n "^body " apps/desktop/src/renderer/styles.css | head -3`
Expected: one line, e.g. `93:body {`. The existing body declares a background (cream paper-100). We'll keep its existing properties but layer the grain overlay on top via a `::before` pseudo-element appended at the file's end.

- [ ] **Step 2: Append the grain overlay + ensure body uses `--paper-warm-bg`**

Append to the END of `apps/desktop/src/renderer/styles.css`:
```css
/* ─────────────────────────────────────────────────────────────
   Design System — Atmosphere (spec §5.1)
   Append-only, overrides body background and adds grain overlay.
   ───────────────────────────────────────────────────────────── */

body {
  background: var(--paper-warm-bg);
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: var(--paper-grain);
  background-size: 160px 160px;
  opacity: 0.5;
  z-index: 0;
}

/* Keep app content above the grain overlay */
#root,
.layout,
.onboarding-layout {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 3: Verify visually**

Reload renderer (`Cmd-R`). Expected: the app still works; cream paper background is slightly warmer with subtle fiber texture. Open any screen — the texture should be visible but quiet (not a tile pattern).

- [ ] **Step 4: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "design-system: apply paper-warm-bg + grain overlay to body"
```

---

### Task 9: Sidebar — wax-mark active indicator + deckle divider

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Find the sidebar nav button render in App.tsx**

Run: `grep -n "sidebar-nav-icon\|sidebar-nav-label" apps/desktop/src/renderer/App.tsx | head -10`
Expected: matches inside the `screens.map` block around line 880-900. The current button renders an icon span + label span + warning dot.

- [ ] **Step 2: Add a wax-mark span at the start of the button content**

Open `apps/desktop/src/renderer/App.tsx`. Inside the `screens.map` block (located near line 881), replace the existing `<button>` body:

Current:
```tsx
<button
  key={screen}
  className={`${activeScreen === screen ? "active" : ""}${screen === "Settings" && sidebarUnhealthy ? " sidebar-nav-has-warning" : ""}`}
  title={sidebarCollapsed ? screen : undefined}
  onClick={() => {
    setActiveScreen(screen);
    if (screen !== "Library") {
      setSelectedLibraryWorkId(null);
    }
  }}
>
  <span className="sidebar-nav-icon">{screenIcons[screen]}</span>
  <span className="sidebar-nav-label">{screen}</span>
  {screen === "Settings" && sidebarUnhealthy ? (
    <span className="sidebar-nav-warning-dot" aria-label="Needs attention" />
  ) : null}
</button>
```

Replace with:
```tsx
<button
  key={screen}
  className={`${activeScreen === screen ? "active" : ""}${screen === "Settings" && sidebarUnhealthy ? " sidebar-nav-has-warning" : ""}`}
  title={sidebarCollapsed ? screen : undefined}
  onClick={() => {
    setActiveScreen(screen);
    if (screen !== "Library") {
      setSelectedLibraryWorkId(null);
    }
  }}
>
  <span className="sidebar-nav-seal" aria-hidden="true">
    {activeScreen === screen ? <span className="ui-wax-mark" /> : null}
  </span>
  <span className="sidebar-nav-icon">{screenIcons[screen]}</span>
  <span className="sidebar-nav-label">{screen}</span>
  {screen === "Settings" && sidebarUnhealthy ? (
    <span className="sidebar-nav-warning-dot" aria-label="Needs attention" />
  ) : null}
</button>
```

- [ ] **Step 3: Add the sidebar-nav-seal slot CSS + deckle divider**

Append to the END of `apps/desktop/src/renderer/styles.css`:
```css
/* ─────────────────────────────────────────────────────────────
   Design System — Sidebar shell (spec §5.2)
   ───────────────────────────────────────────────────────────── */

.sidebar-nav-seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  margin-right: 4px;
}

.sidebar-divider {
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%);
          mask-image: linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%);
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify visually**

Reload (`Cmd-R`). Click each sidebar item. Expected: the active item shows a small wax-red dot to the left of the icon; the divider line between SupportButton and collapse toggle has soft fading edges.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx \
        apps/desktop/src/renderer/styles.css
git commit -m "design-system: wax-mark active indicator + deckle sidebar divider"
```

---

## Phase B — Per-screen migration

> **Important:** From this phase forward, you are *replacing* legacy CSS classes on JSX elements, not deleting CSS rules yet. The legacy classes in `styles.css` remain so other screens keep working. Task 16 removes them in one pass at the end.

### Task 10: Migrate Home screen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/home/SearchHero.tsx`
- Modify: `apps/desktop/src/renderer/screens/home/RandomHighlight.tsx`
- Modify: `apps/desktop/src/renderer/components/SearchFilterChips.tsx`

- [ ] **Step 1: Inspect SearchHero to find the input + suggestion row**

Run: `grep -n "input\|button\|placeholder\|suggestion" apps/desktop/src/renderer/screens/home/SearchHero.tsx | head -30`
Read the file end-to-end so you understand its structure.

- [ ] **Step 2: Swap the hero input to `.ui-input--lg`**

Open `apps/desktop/src/renderer/screens/home/SearchHero.tsx`. Find the `<input>` element with `placeholder="What do you want to find?"`. Add `ui-input ui-input--lg` to its `className`. If it currently sits inside a wrapper that provides border/background (e.g. `.search-hero-input-wrap`), leave the wrapper intact for now — just give the `<input>` itself the new class.

Example: if the JSX currently looks like
```tsx
<input
  className="search-hero-input"
  placeholder="What do you want to find?"
  ...
/>
```
Change to:
```tsx
<input
  className="ui-input ui-input--lg"
  placeholder="What do you want to find?"
  ...
/>
```

- [ ] **Step 3: Swap the suggestion chip row to `.ui-chip`**

Open `apps/desktop/src/renderer/components/SearchFilterChips.tsx`. Locate every `<button>` that renders a chip. Replace its `className` with `ui-chip`. If a chip has an active/selected state, add `ui-chip--active` conditionally:
```tsx
<button
  type="button"
  className={`ui-chip${selected ? " ui-chip--active" : ""}`}
  ...
>
  {label}
</button>
```

- [ ] **Step 4: Swap the random highlight card to `.ui-card--ruled` with drop cap**

Open `apps/desktop/src/renderer/screens/home/RandomHighlight.tsx`. Find the outer wrapper of the highlight (the element with the existing card border + paper background). Change its className to `ui-card ui-card--ruled ui-card--loose`. Inside it, structure the content as:
```tsx
<section className="ui-card ui-card--ruled ui-card--loose">
  <header className="ui-card__eyebrow">A random highlight</header>
  <p className="ui-card__body ui-drop-cap" style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 18, lineHeight: 1.55 }}>
    {quoteText}
  </p>
  <footer className="ui-card__footer">
    <button type="button" className="ui-btn ui-btn--ghost" onClick={onShuffle}>
      Shuffle
    </button>
  </footer>
</section>
```
Preserve whatever attribution / book title link exists below `{quoteText}` — keep it but apply `--type-caption` style: `className="ui-card__body"` with a small `style={{ marginTop: 8, fontSize: 12, color: "var(--ink-500)" }}`.

If the existing component uses a different prop name than `quoteText` / `onShuffle`, keep the existing prop name — only the markup is changing.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 6: Verify visually**

Reload (`Cmd-R`). Navigate to Home. Expected:
- Hero search box is rectangular with warm hairline border and accent-ring focus
- Suggestion chips stay pill-shaped, hover shows accent tint
- Random highlight panel is a ruled card (doubled inset border), first letter of the quote is a large accent serif drop cap
- Shuffle is a ghost button

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/screens/HomeScreen.tsx \
        apps/desktop/src/renderer/screens/home/SearchHero.tsx \
        apps/desktop/src/renderer/screens/home/RandomHighlight.tsx \
        apps/desktop/src/renderer/components/SearchFilterChips.tsx
git commit -m "design-system: migrate Home screen to .ui-* primitives"
```

---

### Task 11: Migrate Library screen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/LibraryScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/library/LibraryAllHighlights.tsx`
- Modify: `apps/desktop/src/renderer/components/SearchResultCard.tsx`

- [ ] **Step 1: Read LibraryScreen.tsx to find the tab strip**

Run: `grep -n "By book\|All highlights\|tab" apps/desktop/src/renderer/screens/LibraryScreen.tsx | head -20`

- [ ] **Step 2: Convert the tab strip to `.ui-tabs`**

In `apps/desktop/src/renderer/screens/LibraryScreen.tsx`, replace the existing tab container + buttons with this structure (preserve the existing state handler — likely `setLibraryTab` or similar):
```tsx
<div className="ui-tabs" role="tablist">
  <button
    type="button"
    role="tab"
    className="ui-tab"
    aria-selected={libraryTab === "by-book"}
    onClick={() => setLibraryTab("by-book")}
  >
    By book
  </button>
  <button
    type="button"
    role="tab"
    className="ui-tab"
    aria-selected={libraryTab === "all-highlights"}
    onClick={() => setLibraryTab("all-highlights")}
  >
    All highlights
  </button>
</div>
```
Match the existing state-variable name and tab-value enum used in the file — only the wrapper + className changes.

- [ ] **Step 3: Swap the search + filter row to `.ui-input` + `.ui-select`**

Locate the "Search passages..." text input and the "All works" select within `LibraryAllHighlights.tsx`. Replace their classNames:
```tsx
<input
  type="text"
  className="ui-input"
  placeholder="Search passages..."
  value={query}
  onChange={(e) => setQuery(e.target.value)}
/>
<select
  className="ui-select"
  value={selectedWork}
  onChange={(e) => setSelectedWork(e.target.value)}
>
  {/* existing option list preserved */}
</select>
```
Preserve all existing handlers and option lists — only the className changes.

- [ ] **Step 4: Convert SearchResultCard to use `.ui-card--tight`**

Open `apps/desktop/src/renderer/components/SearchResultCard.tsx`. Find the outermost wrapper (currently likely `<article className="search-result-card">` or similar). Change its className to `ui-card ui-card--tight` and ensure inner padding is removed:
```tsx
<article className="ui-card ui-card--tight">
  {/* existing inner JSX preserved */}
</article>
```
If the card has its own internal "footer row" (with "Open book" / "Copy" actions), wrap those buttons with `ui-btn ui-btn--ghost`:
```tsx
<button type="button" className="ui-btn ui-btn--ghost" onClick={...}>
  ↗ Open book
</button>
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 6: Verify visually**

Reload (`Cmd-R`). Navigate to Library. Expected:
- Tab strip is underline-style (no colored pill background)
- Search input and "All works" select are both rectangular with warm hairlines
- Each passage card has a warm hairline border + paper gradient + soft shadow
- "Open book" and "Copy" are ghost buttons (no border)

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/screens/LibraryScreen.tsx \
        apps/desktop/src/renderer/screens/library/LibraryAllHighlights.tsx \
        apps/desktop/src/renderer/components/SearchResultCard.tsx
git commit -m "design-system: migrate Library screen to .ui-* primitives"
```

---

### Task 12: Migrate Chat screen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/ChatScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/ChatSetupScreen.tsx`
- Modify: `apps/desktop/src/renderer/components/chat/ChatMessageBubble.tsx`
- Modify: `apps/desktop/src/renderer/components/chat/ChatCitationList.tsx`
- Modify: `apps/desktop/src/renderer/components/chat/ChatStatusBadge.tsx`
- Modify: `apps/desktop/src/renderer/components/chat/ModelPicker.tsx`
- Modify: `apps/desktop/src/renderer/components/chat/PullProgressBar.tsx`

- [ ] **Step 1: Migrate ChatStatusBadge to `.ui-badge--info`**

Open `apps/desktop/src/renderer/components/chat/ChatStatusBadge.tsx`. Replace the existing outer wrapper className with `ui-badge ui-badge--info` and wrap the dot indicator inside `<span className="ui-badge__dot" />`:
```tsx
export function ChatStatusBadge({ modelName }: { modelName: string | null }): JSX.Element {
  return (
    <span className="ui-badge ui-badge--info">
      <span className="ui-badge__dot" />
      Local · Ollama{modelName ? ` (${modelName})` : ""}
    </span>
  );
}
```
Match the actual existing prop names and modelName formatting from the original file — only swap the className.

- [ ] **Step 2: Migrate the New chat button and chat-screen header**

In `apps/desktop/src/renderer/screens/ChatScreen.tsx`, find the `<header className="chat-screen-header">` block. Change the "New chat" button to:
```tsx
<button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={handleNewChat}>
  New chat
</button>
```

- [ ] **Step 3: Migrate the composer (textarea + Send/Stop)**

Still in `ChatScreen.tsx`. Find the `<form className="chat-input">` block. Replace its contents:
```tsx
<form
  className="chat-composer"
  onSubmit={(e) => {
    e.preventDefault();
    void handleSend();
  }}
>
  <textarea
    className="ui-textarea"
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    placeholder="Ask something about your library…"
    disabled={sending}
    rows={3}
  />
  <div className="chat-composer-actions">
    {sending ? (
      <button type="button" className="ui-btn ui-btn--secondary" onClick={turn.cancel}>
        Stop
      </button>
    ) : (
      <button type="submit" className="ui-btn ui-btn--primary" disabled={!draft.trim()}>
        Send
      </button>
    )}
  </div>
</form>
```

Then append the composer layout CSS to the END of `apps/desktop/src/renderer/styles/design-system.css`:
```css
/* ───── Chat composer (spec §6.3) ───── */

.chat-composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat-composer-actions {
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 4: Migrate the assistant bubble + user bubble**

Open `apps/desktop/src/renderer/components/chat/ChatMessageBubble.tsx`. Replace the bubble classNames so:
- User bubble: keep wax-red gradient, switch to a class that uses `--radius-card` + accent fill (defined below)
- Assistant bubble: use `.ui-card .ui-card--tight`

Update the component:
```tsx
import type { ReactNode } from "react";

export type ChatBubbleRole = "user" | "assistant";

export type ChatMessageBubbleProps = {
  role: ChatBubbleRole;
  text: ReactNode;
  footer?: ReactNode;
  ghosted?: boolean;
};

export function ChatMessageBubble(props: ChatMessageBubbleProps): JSX.Element {
  const isUser = props.role === "user";
  const className = [
    isUser ? "chat-bubble-user-v2" : "ui-card ui-card--tight",
    "chat-bubble-v2",
    `chat-bubble-v2--${props.role}`,
    props.ghosted ? "chat-bubble-v2--ghosted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <div className="chat-bubble-v2__text">{props.text}</div>
      {props.footer ? <div className="chat-bubble-v2__footer">{props.footer}</div> : null}
    </div>
  );
}
```

Append the bubble CSS to `design-system.css`:
```css
/* ───── Chat bubbles (spec §6.3) ───── */

.chat-bubble-v2 {
  max-width: 720px;
  font-family: Inter, system-ui, sans-serif;
  font-size: 14.5px;
  line-height: 1.55;
  word-break: break-word;
}
.chat-bubble-v2__text { white-space: pre-wrap; }
.chat-bubble-v2__footer {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-500);
}
.chat-bubble-v2--assistant { align-self: flex-start; }
.chat-bubble-v2--user {
  align-self: flex-end;
}
.chat-bubble-v2--ghosted {
  opacity: 0.55;
  font-style: italic;
}

.chat-bubble-user-v2 {
  padding: 14px 18px;
  background: linear-gradient(180deg, var(--accent-500) 0%, var(--accent-strong) 100%);
  color: #fff;
  border: 1px solid color-mix(in srgb, var(--accent) 56%, transparent);
  border-radius: var(--radius-card);
  border-bottom-right-radius: 6px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 6px 14px -8px rgba(178, 63, 47, 0.35);
}
```

- [ ] **Step 5: Migrate ChatCitationList to use `.ui-card__eyebrow` + `.ui-card--tight` rows + footnote-ref**

Open `apps/desktop/src/renderer/components/chat/ChatCitationList.tsx`. Replace its body with:
```tsx
import type { SearchResult } from "@archi/search";
import { SearchResultCard } from "../SearchResultCard.js";

export type ChatCitationListProps = {
  citations: SearchResult[];
  messageId: string;
  onOpenWork: (workId: string, passageId: string) => void;
};

export function ChatCitationList({
  citations,
  messageId,
  onOpenWork,
}: ChatCitationListProps): JSX.Element {
  if (citations.length === 0) return <></>;
  return (
    <div className="chat-sources-v2">
      <h3 className="ui-card__eyebrow">Sources</h3>
      <ol className="chat-citations-v2">
        {citations.map((c, i) => (
          <li
            key={c.passageId}
            id={`citation-${messageId}-${i + 1}`}
            className="chat-citation-v2"
          >
            <span className="chat-citation-v2__number">
              <span className="ui-footnote-ref" aria-hidden="true">{i + 1}</span>
            </span>
            <SearchResultCard
              result={c}
              showMatchSource={false}
              expanded={false}
              onToggle={() => undefined}
              onOpenWork={onOpenWork}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
```

Append CSS to `design-system.css`:
```css
/* ───── Chat sources panel ───── */

.chat-sources-v2 {
  max-width: 720px;
  margin-top: 6px;
  align-self: flex-start;
  width: 100%;
}
.chat-citations-v2 {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.chat-citation-v2 {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 8px;
  align-items: start;
}
.chat-citation-v2__number {
  margin-top: 6px;
  text-align: center;
}
```

- [ ] **Step 6: Update the footnote-ref handler in ChatScreen**

Open `apps/desktop/src/renderer/screens/ChatScreen.tsx`. The existing `renderWithCitations` helper uses `.chat-citation-ref`. Change it to `.ui-footnote-ref`:

Find the `<button` rendered inside `renderWithCitations`. Replace its className `"chat-citation-ref"` with `"ui-footnote-ref"`. The button's onClick (jumpToCitation) stays the same. The flash class in `jumpToCitation` should also change from `chat-citation-flash` to `ui-footnote-flash`. Both occurrences inside `jumpToCitation`:
```ts
el.classList.remove("ui-footnote-flash");
void el.offsetWidth;
el.classList.add("ui-footnote-flash");
window.setTimeout(() => el.classList.remove("ui-footnote-flash"), 1600);
```

- [ ] **Step 7: Migrate ChatSetupScreen buttons + inputs**

Open `apps/desktop/src/renderer/screens/ChatSetupScreen.tsx`. Replace every `<button>` and any input with the new system. Specifically:
- "Download Ollama" button → `className="ui-btn ui-btn--primary"`
- "I've installed it — recheck" button → `className="ui-btn ui-btn--secondary"`
- "Recheck" button (error state) → `className="ui-btn ui-btn--secondary"`
- "Pull {RECOMMENDED_PRIMARY}" button → `className="ui-btn ui-btn--primary"`
- "Use {selected}" button → `className="ui-btn ui-btn--primary"`

Wrap each top-level setup screen in a `.ui-card`:
```tsx
<div className="chat-setup-shell">
  <section className="ui-card ui-card--ruled ui-card--loose chat-setup-card">
    <h1 className="ui-card__title">Local AI chat for your library</h1>
    {/* existing body content */}
    <div className="ui-card__footer">{/* action buttons */}</div>
  </section>
</div>
```
Apply the same shell wrapping to all five setup states (loading, not_installed, error, no_models, ready).

Append CSS to `design-system.css`:
```css
/* ───── Chat setup shell ───── */

.chat-setup-shell {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 48px 24px;
  overflow-y: auto;
}
.chat-setup-card {
  width: min(640px, 100%);
}
.chat-setup-card .ui-card__footer {
  justify-content: center;
  flex-wrap: wrap;
}
```

- [ ] **Step 8: Migrate ModelPicker and PullProgressBar**

In `apps/desktop/src/renderer/components/chat/ModelPicker.tsx`, swap each row's outer container to `.ui-card ui-card--tight`. The selected row gets an extra `chat-model-row-selected` class — the existing CSS for that selected accent treatment can stay. Buttons inside (Pull / Use) use `.ui-btn ui-btn--secondary`.

In `apps/desktop/src/renderer/components/chat/PullProgressBar.tsx`, wrap the progress bar in `.ui-card .ui-card--tight`. The bar fill keeps its existing `.chat-pull-bar` / `.chat-pull-bar-fill` CSS — those are unique to this component.

- [ ] **Step 9: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 10: Verify visually**

Reload (`Cmd-R`). Navigate to Chat. Expected:
- Status badge has the new pill `--info` styling
- New chat is a small secondary button
- Composer textarea + Send button feel like one design family
- Assistant bubbles are paper cards with warm hairline border
- User bubbles keep accent gradient
- Citation footnotes are italic Newsreader numerals in circles
- Setup screens (sign out and clear pref, or click New chat → setup state) render inside a ruled card

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src/renderer/screens/ChatScreen.tsx \
        apps/desktop/src/renderer/screens/ChatSetupScreen.tsx \
        apps/desktop/src/renderer/components/chat/ChatMessageBubble.tsx \
        apps/desktop/src/renderer/components/chat/ChatCitationList.tsx \
        apps/desktop/src/renderer/components/chat/ChatStatusBadge.tsx \
        apps/desktop/src/renderer/components/chat/ModelPicker.tsx \
        apps/desktop/src/renderer/components/chat/PullProgressBar.tsx \
        apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: migrate Chat screen to .ui-* primitives"
```

---

### Task 13: Migrate Settings screen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/SettingsScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/SourcesScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/NotionScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/LogsScreen.tsx`

- [ ] **Step 1: Convert Settings top tabs to `.ui-tabs`**

Open `apps/desktop/src/renderer/screens/SettingsScreen.tsx`. Find the tablist (currently colored pill-style). Replace with:
```tsx
<div className="ui-tabs" role="tablist" aria-label="Settings">
  <button
    type="button"
    role="tab"
    className="ui-tab"
    aria-selected={activeTab === "connections"}
    onClick={() => setActiveTab("connections")}
  >
    Connections
  </button>
  <button
    type="button"
    role="tab"
    className="ui-tab"
    aria-selected={activeTab === "logs"}
    onClick={() => setActiveTab("logs")}
  >
    Logs
  </button>
  <button
    type="button"
    role="tab"
    className="ui-tab"
    aria-selected={activeTab === "search"}
    onClick={() => setActiveTab("search")}
  >
    Search
  </button>
</div>
```
Match the actual `activeTab` state name and tab-value strings used in the file.

- [ ] **Step 2: Convert each connection card to `.ui-card`**

Open `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`. Each integration block (Kindle, Notion) currently uses a `connection-card` wrapper. Update to:
```tsx
<section className="ui-card">
  <header className="connection-card-header">
    <h2 className="ui-card__title">Kindle Highlights</h2>
    <span className={`ui-badge ui-badge--${kindleStatus}`}>{kindleStatusLabel}</span>
  </header>
  {/* existing body content stays */}
  <footer className="ui-card__footer connection-card-footer">
    <button type="button" className="ui-btn ui-btn--secondary" onClick={handleConnect}>Connect</button>
    <button type="button" className="ui-btn ui-btn--secondary" onClick={handleReconnect}>Reconnect</button>
    <button type="button" className="ui-btn ui-btn--secondary" onClick={handleTest}>Test</button>
  </footer>
</section>
```
Map status to badge variant: `connected` → `ok`, `needs_action` → `warn`, `error` → `warn`, `idle` → `neutral`. The existing status value field in the connection state object should drive this.

Append CSS to `design-system.css`:
```css
/* ───── Settings cards ───── */

.connection-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.connection-card-header .ui-card__title {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: 0;
}
.connection-card-footer {
  justify-content: flex-start;
}
```

- [ ] **Step 3: Convert Notion token input + buttons**

In the Notion block within `ConnectionsScreen.tsx`, swap the token `<input>` to:
```tsx
<input
  type="password"
  className="ui-input"
  placeholder="Token saved. Paste a new token to replace"
  value={tokenDraft}
  onChange={(e) => setTokenDraft(e.target.value)}
/>
```
Buttons become:
```tsx
<button type="button" className="ui-btn ui-btn--primary" onClick={handleUpdateToken}>Update token</button>
<button type="button" className="ui-btn ui-btn--secondary" onClick={handleRefresh}>Refresh</button>
<button type="button" className="ui-btn ui-btn--secondary" onClick={handleRunTest}>Run test</button>
<button type="button" className="ui-btn ui-btn--danger" onClick={handleDisconnect}>Disconnect</button>
<button type="button" className="ui-btn ui-btn--secondary" onClick={handleRefreshNotionMedia}>Refresh Notion media</button>
```
Match the existing handler names from the file.

- [ ] **Step 4: Convert Search card in SourcesScreen / wherever it lives**

The Search index card lives inside `apps/desktop/src/renderer/screens/SourcesScreen.tsx` (or wherever the `INDEX STATUS / RUNTIME / EMBEDDING MODEL` block renders — grep for `EMBEDDING MODEL` to locate). Wrap it as:
```tsx
<section className="ui-card">
  <header className="connection-card-header">
    <h2 className="ui-card__title">Search</h2>
    <span className="ui-badge ui-badge--neutral">{runtimeState}</span>
  </header>
  <dl className="search-card-stats">
    <div>
      <dt className="ui-card__eyebrow">Index status</dt>
      <dd>{indexedCount} of {totalCount} highlights indexed</dd>
    </div>
    <div>
      <dt className="ui-card__eyebrow">Runtime</dt>
      <dd>{runtimeState}</dd>
    </div>
    <div>
      <dt className="ui-card__eyebrow">Embedding model</dt>
      <dd><code>bge-small-en-v1.5</code> — managed by Archi</dd>
    </div>
  </dl>
</section>
```
Preserve the actual value bindings from the file — likely from `searchHealth` or `searchStatus` props.

Append CSS to `design-system.css`:
```css
/* ───── Search index card ───── */

.search-card-stats {
  display: grid;
  gap: 14px;
  margin: 0;
}
.search-card-stats dt { margin-bottom: 4px; }
.search-card-stats dd {
  margin: 0;
  font-family: Inter, system-ui, sans-serif;
  font-size: 14px;
  color: var(--ink-700);
}
.search-card-stats code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  background: color-mix(in srgb, var(--accent-soft) 50%, var(--surface));
  padding: 1px 6px;
  border-radius: 4px;
}
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 6: Verify visually**

Reload (`Cmd-R`). Navigate to Settings. Expected:
- Top tabs (Connections / Logs / Search) are underline-style
- Each connection block is a unified card with Newsreader title + status badge
- Action buttons match the system (secondary outlined, primary wax-red, danger outlined red)
- Token input is the rectangular `.ui-input`
- Search card stats use small-caps eyebrows for labels

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/screens/SettingsScreen.tsx \
        apps/desktop/src/renderer/screens/ConnectionsScreen.tsx \
        apps/desktop/src/renderer/screens/SourcesScreen.tsx \
        apps/desktop/src/renderer/screens/NotionScreen.tsx \
        apps/desktop/src/renderer/screens/LogsScreen.tsx \
        apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: migrate Settings screen to .ui-* primitives"
```

---

### Task 14: Migrate book detail screen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx`

- [ ] **Step 1: Read the file to map the existing wrapper**

Run: `head -60 apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx`
Identify the outer wrapper and the inner passage list.

- [ ] **Step 2: Wrap the detail body in `.ui-card--ruled`**

In `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx`, change the outermost render wrapper to:
```tsx
<article className="ui-card ui-card--ruled ui-card--loose book-detail-card">
  {/* existing inner content preserved */}
</article>
```

For the passage list inside this card, ensure each row uses `.ui-card ui-card--tight` (it should already if Task 11 migrated `SearchResultCard`, which is the same component). No further change needed if the list reuses `SearchResultCard`.

Append CSS to `design-system.css`:
```css
/* ───── Book detail ───── */

.book-detail-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 4: Verify visually**

Reload (`Cmd-R`). Navigate to Library, click a book. Expected:
- Outer frame is a ruled card (doubled inset border)
- Back chevron + title header remain
- Inner passage list uses the same card style as Library

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx \
        apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: migrate book detail to .ui-card--ruled"
```

---

### Task 15: Migrate onboarding wizard

**Files:**
- Modify: `apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx`
- Modify: `apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx`
- Modify: `apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx`
- Modify: `apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx`
- Modify: `apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx`
- Modify: `apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx`
- Modify: `apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx`

- [ ] **Step 1: Wrap WizardChrome in `.ui-card--ruled`**

Open `apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx`. Find the outer step wrapper. Change className to `ui-card ui-card--ruled ui-card--loose wizard-chrome-card`.

Append CSS to `design-system.css`:
```css
/* ───── Onboarding ───── */

.wizard-chrome-card {
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.wizard-chrome-card .ui-card__title {
  font-size: 24px;
  line-height: 1.2;
}
.wizard-chrome-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
}
.wizard-chrome-actions .left-actions { display: flex; gap: 8px; }
.wizard-chrome-actions .right-actions { display: flex; gap: 8px; }
```

- [ ] **Step 2: Convert primary + secondary CTAs in WizardChrome footer**

In `WizardChrome.tsx`, the navigation buttons (Back, Continue, Skip) should become:
```tsx
<div className="wizard-chrome-actions">
  <div className="left-actions">
    {showBack ? (
      <button type="button" className="ui-btn ui-btn--ghost" onClick={onBack}>
        Back
      </button>
    ) : null}
  </div>
  <div className="right-actions">
    {showSkip ? (
      <button type="button" className="ui-btn ui-btn--secondary" onClick={onSkip}>
        Skip
      </button>
    ) : null}
    {showNext ? (
      <button
        type="button"
        className="ui-btn ui-btn--primary"
        onClick={onNext}
        disabled={!canAdvance}
      >
        {nextLabel ?? "Continue"}
      </button>
    ) : null}
  </div>
</div>
```
Match the actual existing prop names and conditions from the file.

- [ ] **Step 3: Convert each step's headline + inputs**

For each of the 5 step files:
- Wrap the step's title in `<h1 className="ui-card__title">…</h1>`
- Wrap body copy in `<div className="ui-card__body">…</div>`
- Convert any input fields to `.ui-input`
- Convert any inline buttons to `.ui-btn ui-btn--secondary` (unless a step uses a primary "Test"/"Authorize" action — those become `.ui-btn ui-btn--primary`)

Read each step file first to see what controls it renders; only the className strings change.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify visually**

To enter onboarding, clear the onboarding-complete preference (open DevTools console: `await window.archi.preferences.set('onboarding.complete', false)` then reload). Walk through all 5 steps. Expected:
- Each step renders in a ruled card
- Title is Newsreader 24px
- Inputs (token, paths) are rectangular hairline
- Back / Skip / Continue match the button system

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx \
        apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx \
        apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx \
        apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx \
        apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx \
        apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx \
        apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx \
        apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: migrate onboarding wizard to .ui-* primitives"
```

---

### Task 16: Migrate modals (Support prompt)

**Files:**
- Modify: `apps/desktop/src/renderer/components/SupportPromptModal.tsx`

- [ ] **Step 1: Wrap the modal surface in `.ui-card`**

Open `apps/desktop/src/renderer/components/SupportPromptModal.tsx`. The modal surface currently has its own classes. Change the inner panel className to `ui-card ui-modal-card`, and wrap action buttons with `.ui-btn` variants:
```tsx
<div className="ui-modal-backdrop" onClick={onClose}>
  <div className="ui-card ui-modal-card" onClick={(e) => e.stopPropagation()}>
    <h2 className="ui-card__title">{title}</h2>
    <div className="ui-card__body">{body}</div>
    <div className="ui-card__footer">
      <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose}>Not now</button>
      <button type="button" className="ui-btn ui-btn--primary" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>
```
Preserve the actual prop names (title, body, onClose, onConfirm, confirmLabel) from the file.

Append CSS to `design-system.css`:
```css
/* ───── Modal (spec §6.7) ───── */

.ui-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(60, 38, 26, 0.36);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 100;
}
.ui-modal-card {
  width: min(480px, 100%);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-raised);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 3: Verify visually**

Trigger the support prompt (e.g. set a session counter that triggers it, or temporarily render `<SupportPromptModal open={true} ... />` in App.tsx to see it). Expected:
- Backdrop is warm-brown tint
- Modal panel uses the unified card style with serif title
- Buttons match the system

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/SupportPromptModal.tsx \
        apps/desktop/src/renderer/styles/design-system.css
git commit -m "design-system: migrate Support prompt modal to .ui-* primitives"
```

---

## Phase C — Cleanup

### Task 17: Delete legacy CSS rules from styles.css

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Identify the legacy class blocks to delete**

The following CSS blocks in `styles.css` are no longer referenced by any JSX (verify per class with grep before deleting):

Legacy classes to delete:
- `.screen-card` (lines around 465-475 — used to wrap every screen; now `.ui-card` takes over via per-screen migration)
- `.search-result-card` outer styles (the card's inner content styles like `.search-result-card-quote` may still be referenced — only delete rules whose JSX consumer is gone)
- `.connection-card` and its children
- `.chat-input` (replaced by `.chat-composer`)
- `.chat-bubble`, `.chat-bubble-user`, `.chat-bubble-assistant` (replaced by `.chat-bubble-v2*`)
- `.chat-citations`, `.chat-citation`, `.chat-citation-number`, `.chat-citation-ref` (replaced by `.chat-citations-v2*` + `.ui-footnote-ref`)
- `.chat-sources`, `.chat-sources-header`
- `.chat-screen-new` (replaced by `.ui-btn--secondary--sm`)
- `.chat-message-block` (replaced by transcript flex column directly)
- `.chat-pull` (the pull-progress container; if still used by `PullProgressBar`, keep; otherwise delete)
- `.chat-model-row` outer card frame (replaced by `.ui-card--tight` — but `.chat-model-row-selected` accent treatment may still be referenced)
- `.search-hero-input` (replaced by `.ui-input--lg`)
- `.search-filter-chip` (replaced by `.ui-chip`)
- Settings tablist legacy `.settings-tab` / `.settings-tabs` (replaced by `.ui-tabs` / `.ui-tab`)

- [ ] **Step 2: For each candidate class, grep the entire renderer for references**

```bash
for klass in screen-card connection-card chat-input chat-bubble-user chat-bubble-assistant chat-citation-ref chat-screen-new chat-message-block search-hero-input search-filter-chip settings-tab; do
  echo "=== .${klass} ===";
  grep -rn "\"${klass}\\|'${klass}\\|\`${klass}" apps/desktop/src/renderer --include="*.tsx" --include="*.ts" || echo "  (no references)";
done
```
For each class that returns `(no references)`, it is safe to delete its CSS block. For classes that still have references, leave them — that means a screen migration missed a spot; go back and migrate before continuing.

- [ ] **Step 3: Delete the unreferenced CSS blocks from styles.css**

Open `apps/desktop/src/renderer/styles.css`. Delete the CSS rule blocks for every class that Step 2 confirmed has no references. Preserve any rule whose selector is still in use.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm -F @archi/desktop typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify visually — walk every screen one more time**

Reload (`Cmd-R`). Open each: Home, Library (with both tabs), book detail, Chat (with a sent question), Settings (each tab), onboarding wizard (if reachable). Compare against `docs/qa/design-system.md`. Expected: every screen looks correct under the new system; nothing is unstyled.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "design-system: delete legacy CSS classes superseded by .ui-* primitives"
```

---

## Self-Review

Spec coverage:

| Spec section | Task(s) |
| --- | --- |
| §3 Foundations / tokens | Task 1 |
| §4.1 `.ui-card` | Task 2 |
| §4.2 fields | Task 3 |
| §4.3 buttons | Task 4 |
| §4.4 chips & badges | Task 5 |
| §4.5 tabs | Task 6 |
| §4.6 dividers & decorations | Task 6 |
| §4.7 wax-seal marker | Task 7, Task 9 (applied to sidebar) |
| §4.8 footnote ref | Task 7, Task 12 (applied in Chat) |
| §5 atmosphere | Task 8, Task 9 |
| §6.1 Home | Task 10 |
| §6.2 Library | Task 11 |
| §6.3 Chat | Task 12 |
| §6.4 Settings | Task 13 |
| §6.5 Book detail | Task 14 |
| §6.6 Onboarding | Task 15 |
| §6.7 Modals | Task 16 |
| §7 cleanup | Task 17 |

All spec sections have a corresponding task.

Placeholder scan: none of the steps say TBD / TODO / "implement later" / "similar to". Every CSS block and JSX snippet is shown inline.

Type consistency: the `.ui-*` class names are consistent across all tasks. Custom helper classes introduced in migration (`.chat-composer`, `.chat-bubble-v2`, `.chat-citations-v2`, `.wizard-chrome-card`, `.book-detail-card`, `.ui-modal-card`) are defined in the same task that introduces them. The footnote-ref's flash class (`ui-footnote-flash`) is defined in Task 7 and consumed in Task 12 — consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-design-system.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task with two-stage review (spec compliance, then code quality). Best for this plan because each task is well-scoped and self-contained.
2. **Inline Execution** — Execute tasks in this session using executing-plans; batch with checkpoints.

Which approach?
