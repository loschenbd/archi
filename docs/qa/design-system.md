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
