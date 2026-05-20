# Passages screen virtualization: design

**Date:** 2026-05-20
**Author:** Archi maintainers (drafted via brainstorming session)
**Status:** Draft, awaiting user review before implementation planning
**Scope:** `apps/desktop/src/renderer/screens/PassagesScreen.tsx`, `apps/desktop/src/renderer/styles.css`, `apps/desktop/package.json` (add `@tanstack/react-virtual`).

## Problem

The Passages screen renders every matching passage as a card in a single `<ul className="passages-list">`. With several thousand passages already loaded into renderer state by `App.tsx` (`listPassages` IPC, eager on mount), React reconciles thousands of DOM nodes on first mount and again on every keystroke in the search box. The page is sluggish to open and stutters while typing. The IPC fetch itself is fine — the bottleneck is the React render and the resulting DOM size.

## Goals

- The Passages screen opens and feels responsive with the current dataset (~thousands of passages, headroom to ~5,000).
- Typing in the search box updates results without perceptible lag.
- Visual design, card markup, filter UI, count line, and empty state remain identical to today.
- No changes to the IPC contract, the main process, or the core repository.

## Success criteria

- Opening the Passages screen with ~5,000 passages mounts in well under a second on a development machine and shows no visible jank when scrolling.
- Typing in the search input feels instant — no measurable input lag at ~5,000 passages.
- Filter changes (search query or work filter) reset the list scroll position to the top so the user sees the top of the new result set.
- The "{count} passage(s)" line, the "No passages synced yet" empty state, and every passage card (quote glyph, body, attribution, Open book, Copy buttons) look and behave exactly as before.
- No regressions in `LibraryBookDetailScreen` (which uses the per-work IPC and is out of scope here).

## Non-goals

- Server-side or IPC-level pagination. The renderer continues to receive the full passage list from `listPassages`. At the current scale this is fine; if the dataset grows past ~tens of thousands a follow-up spec can move list/search to the main process.
- A page-numbered or "load more" pagination UI. The user explicitly chose virtualization over discrete pages — the list still feels like one continuous list.
- Changes to passage card styling, the search UX, or the filter dropdown.
- Sorting controls, deep-linking to a position, or scroll restoration across navigation away and back.
- Touching `PassagesScreen`'s sibling screens or the data layer (`listPassages` IPC handler, `coreRepository`, etc.).

## Approach

All changes live inside `PassagesScreen.tsx` and a small CSS addition in `styles.css`. The component continues to receive the full `passages` array as a prop. The `filtered` memo, `query`, `workFilter`, and `copiedId` state stay exactly as they are. Only the list rendering changes.

### Layout shift: pinned filters, bounded scrolling list

Today the entire `.passages-screen` participates in the page scroll, so the filters scroll away with the list. The virtualizer needs a bounded, scrollable element to operate on, and the user picked the variant where filters/header stay pinned while the list scrolls inside its own container.

The `<section className="passages-screen">` becomes a flex column: intro paragraph, filters, count line, then a list region that takes the remaining vertical space. The list region is the virtualizer's scroll element and is the only scrollable area inside the screen.

CSS sketch (added to `styles.css`):

```css
.passages-screen {
  /* override existing `display: grid` for this screen */
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.passages-list-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* room for shadow on the bottom-most card */
  padding-bottom: 4px;
}

.passages-list-inner {
  position: relative;
  width: 100%;
}

.passages-list-row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  /* gap is rendered as bottom padding on the row so absolute positioning still spaces cards */
  padding-bottom: 8px;
  box-sizing: border-box;
}
```

The existing `.passages-list` selector (which uses `display: grid; gap: 8px`) no longer applies once the `<ul>` is replaced by the virtualized container; the `gap` is replaced by `padding-bottom: 8px` on `.passages-list-row` so spacing stays visually identical. The `.logs-list` selector still shares that rule today, so the grouped CSS rule (`.passages-list, .logs-list`) is split: `.logs-list` keeps the grid/gap; `.passages-list` (if any references remain) is removed or repurposed.

The screen as a whole needs to live in a bounded height for `flex: 1 1 auto` + `min-height: 0` to work. App-level container styling should already provide that (the screens render inside the main app shell), but the spec's implementation step must verify this in the running app and add a parent constraint if needed.

### Virtualizer integration

Add `@tanstack/react-virtual` to `apps/desktop` dependencies. Versions: pin to the current `^3.x` major.

Inside `PassagesScreen`:

```tsx
const scrollRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: filtered.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 180,
  overscan: 6,
  getItemKey: (index) => filtered[index].id,
});
```

- `estimateSize`: 180px is a reasonable placeholder for the average passage card. Exact value can be tuned in implementation; the virtualizer auto-corrects via dynamic measurement.
- `overscan`: 6 rows above and below the viewport balances smooth scrolling and minimum mounted nodes.
- `getItemKey`: returns the stable passage id so React reconciliation survives reordering (e.g., filter changes).

Each rendered row uses `measureElement` so variable-height passage cards report their real height after mount:

```tsx
<div
  key={virtualItem.key}
  data-index={virtualItem.index}
  ref={virtualizer.measureElement}
  className="passages-list-row"
  style={{ transform: `translateY(${virtualItem.start}px)` }}
>
  {/* existing <li className="passage-card"> markup, wrapped in a fragment or div instead of <li> */}
</div>
```

The outer `<ul>` is replaced by a `<div className="passages-list-scroll" ref={scrollRef}>` containing a `<div className="passages-list-inner" style={{ height: virtualizer.getTotalSize() }}>` containing the positioned rows. The current passage card markup is preserved inside each row; the only change is the wrapper element (no longer `<li>` because there is no `<ul>` parent).

### Scroll-to-top on filter change

When `query` or `workFilter` changes, the result set may shift entirely. Scroll the list back to the top so the user sees the new top result:

```tsx
useEffect(() => {
  scrollRef.current?.scrollTo({ top: 0 });
}, [query, workFilter]);
```

This runs after `filtered` recomputes, which runs after the state change. The virtualizer reads the new `count` on the same render.

### What stays the same

- `Passage` type, `Props`, `query`/`workFilter`/`copiedId` state, the `works` and `filtered` memos, `copyPassage` behavior, the filters block, the count line, and the empty-state paragraph.
- The "No passages synced yet" branch still renders the existing paragraph instead of the scroll container when `filtered.length === 0`.
- The passage card's DOM structure (quote glyph, blockquote, footer with attribution and action buttons) and all its CSS classes.

## Testing

Manual verification on the running desktop app:

- Open the Passages screen with the current dataset; confirm it appears quickly and the cards look identical to today.
- Type a few characters in the search box, then clear them; confirm input feels instant and the list scrolls back to the top on each change.
- Switch the work filter to a specific work and back to "All works"; confirm the list resets to the top and shows the right items.
- Click "Open book" on a card and confirm it navigates as before.
- Click "Copy" on a card and confirm the "Copied" affordance still flashes.
- Scroll through the list; confirm there is no flicker, no measurable lag, and no missing rows. Especially check the boundary between very short and very long passage bodies.
- Trigger an "empty" state by filtering to a query that matches nothing; confirm the existing "No passages synced yet" paragraph appears.

No automated tests are added: the screen has no existing test coverage, the data flow is unchanged, and the change is purely a rendering optimization within an Electron renderer (no headless React test harness is set up for this app).

## Risks and rollback

- **Height-bound parent missing.** If the screen's parent doesn't provide a bounded height, `flex: 1 1 auto` collapses to zero and nothing renders. Mitigation: verify in the running app during implementation; if needed, add a height constraint on the parent shell in `App.tsx`'s screen container.
- **Dynamic measurement jitter on first paint.** With `estimateSize: 180`, very tall cards may briefly overlap before measurement settles. Mitigation: keep `estimateSize` close to the realistic average; the visible effect is minor and only on the first frame.
- **Loss of native `<ul>`/`<li>` semantics.** Switching to `<div>` rows trades a small a11y benefit for a clean virtualization API. Acceptable for a desktop app; if a11y testing later flags it, swap to `role="list"`/`role="listitem"` on the wrapper and row elements.
- **Rollback:** revert this file plus the CSS changes; remove `@tanstack/react-virtual` from `package.json`. No data, IPC, or main-process state is touched, so rollback is purely a renderer revert.
