# Archi marketing site: design

**Date:** 2026-05-20
**Author:** Archi maintainers (drafted via brainstorming session)
**Status:** Draft, awaiting user review before implementation planning
**Scope:** New workspace package `apps/marketing/`, new GitHub Actions workflow `.github/workflows/marketing-deploy.yml`, GitHub Pages configuration, and DNS for `archi.benjaminloschen.com`.

## Problem

Archi has no public landing page. There is nowhere to send a prospective user, no "Download for macOS" surface, and no story for the product beyond `README.md`. We need a marketing site that converts the right kind of visitor into a download, hosted at `archi.benjaminloschen.com` via GitHub Pages and living in this repo.

## Positioning

Archi is a **searchable home for your Kindle highlights**. The product weight is the local searchable library that lives on the user's Mac. Notion is one export destination, not the headline. This shapes every section: search comes first; Notion is supporting evidence, not the lede.

### One-line positioning

> Every Kindle highlight you've ever made. Finally searchable.

### Supporting lede

> Archi is a quiet macOS app that pulls your Kindle highlights into a local library you can actually search. Send any book to Notion when you want it there.

## Goals

- A single long-scroll landing page that converts the right kind of reader into a macOS download.
- Visual continuity with the desktop app — same fonts, same palette, same tone.
- Zero ongoing maintenance overhead: the site rebuilds and redeploys on push to `main` whenever marketing files change.
- Owned domain at `archi.benjaminloschen.com` with automatic HTTPS.
- Lighthouse Performance / Accessibility / Best Practices all ≥ 95 on first load over a throttled mobile profile, measured locally by the implementer before declaring v1 done. Not a CI gate in v1.

## Success criteria

- A visitor on `archi.benjaminloschen.com` sees the hero — headline, lede, search demo, download CTA — without scrolling on a 1440×900 desktop viewport.
- Clicking "Download for macOS" downloads the latest signed `.dmg` from the GitHub release of `loschenbd/archi` without any intermediate page.
- "View on GitHub" opens `https://github.com/loschenbd/archi`.
- The site builds and deploys automatically when a PR touching `apps/marketing/**` lands on `main`.
- The site loads with no client-side JavaScript on the critical path (Astro static output; any interactivity is opt-in islands).
- Custom domain serves over HTTPS without a certificate warning.
- The page passes axe-core accessibility checks (run locally via the browser extension or `@axe-core/cli`) with no critical violations before declaring v1 done. Not a CI gate in v1.

## Non-goals

- A multi-page site, blog, docs portal, or changelog page. If user docs are needed later, they go in a separate `docs/` site under a future spec.
- Internationalisation. Site is English-only.
- A/B testing or analytics. No tracking pixels, no GA, no Plausible in v1. The privacy story stays clean.
- Email capture or waitlist forms. The only conversion event is "click the download button."
- Dark mode. The desktop app has a strong light identity and the site matches.
- An Intel-build CTA. The desktop ships Apple Silicon only today.
- Component reuse from `packages/ui`. The marketing site is its own surface with its own styling pipeline; copying tokens is cheaper than refactoring a shared package out of the renderer.

## Architecture

### Location and workspace integration

The site lives at `apps/marketing/`, registered in `pnpm-workspace.yaml` alongside `apps/desktop`. It uses its own `package.json` with `@archi/marketing` as the package name. It does not depend on any other workspace package; this keeps its build hermetic and its CI fast.

### Stack

- **Astro** for the static-site generator. Astro emits zero JavaScript by default, which fits a download-funnel landing page where the only interaction is clicking CTAs. The `astro-pages` integration is unnecessary; we deploy the `dist/` output directly through GitHub Actions.
- **Tailwind CSS** via `@astrojs/tailwind`. Tailwind is configured with a custom theme that mirrors the design tokens from `apps/desktop/src/renderer/styles.css` (see "Design tokens" below).
- **No React.** Astro components only. If we later need interactive islands (an animated demo, for example), Astro can hydrate any framework at that point; nothing in v1 requires hydration.
- **TypeScript** for any `.ts`/`.astro` script blocks.

### File layout

```
apps/marketing/
  astro.config.mjs
  tailwind.config.mjs
  tsconfig.json
  package.json
  public/
    CNAME                     # contains "archi.benjaminloschen.com"
    favicon.ico
    favicon.svg
    og-image.png              # 1200x630, generated from hero treatment
  src/
    layouts/
      Site.astro              # <html>, <head>, fonts, og tags, footer
    components/
      Nav.astro
      Hero.astro              # headline, lede, CTAs, embedded search demo
      SearchDemo.astro        # the styled search card from the mockup
      HowItWorks.astro        # 3-step explainer
      FeatureGrid.astro       # 3x2 capability grid
      NotionPreview.astro     # before/after split
      Faq.astro
      Footer.astro
      DownloadButton.astro    # accepts a `variant` prop
    pages/
      index.astro             # composes the components above
    styles/
      tokens.css              # CSS custom properties mirroring app tokens
      global.css              # @import tokens.css + base resets
    assets/
      screenshots/            # placeholder for real app captures
```

### Design tokens

`tailwind.config.mjs` defines a theme that mirrors the variables in `apps/desktop/src/renderer/styles.css`:

```js
theme: {
  extend: {
    colors: {
      ink: { 900: "#2a2520", 700: "#4a3f37", 500: "#6b5d52", 300: "#a89f95", 100: "#d4ccc2" },
      paper: { white: "#fefdfb", 50: "#faf9f6", 100: "#f5f3f0", 200: "#ede8e1" },
      accent: { DEFAULT: "#c84c3c", strong: "#b23f2f", soft: "#fae8e3" },
    },
    fontFamily: {
      serif: ['Newsreader', 'Georgia', 'serif'],
      sans:  ['Inter', 'system-ui', 'sans-serif'],
    },
    borderRadius: { DEFAULT: "12px" },
  }
}
```

Newsreader and Inter are loaded from Google Fonts in `Site.astro` `<head>` using the exact weights the app uses. The hero's soft radial-gradient background uses the same `radial-gradient` declarations as the app's `body`.

This duplication is intentional. A shared tokens package is overkill for one consumer; if a third surface ever appears, that triggers a follow-up extraction.

### Deploy pipeline

A single workflow at `.github/workflows/marketing-deploy.yml`:

- **Trigger:** push to `main` with a path filter on `apps/marketing/**`, plus a `workflow_dispatch` for manual rebuilds.
- **Jobs:**
  - `build`: checkout, setup pnpm + Node (matching `.nvmrc`), `pnpm install --filter @archi/marketing...`, `pnpm --filter @archi/marketing build`, upload `apps/marketing/dist` as a Pages artifact via `actions/upload-pages-artifact`.
  - `deploy`: depends on `build`, runs only on `main`, uses `actions/deploy-pages@v4` with the `github-pages` environment.
- **Permissions:** workflow grants `pages: write`, `id-token: write`, `contents: read`.
- **Repo settings prerequisite:** Settings → Pages → Source set to "GitHub Actions" (one-time manual setup, documented in the implementation plan).

### Custom domain

- `public/CNAME` contains a single line: `archi.benjaminloschen.com`. Astro copies `public/` verbatim into `dist/`, so the file is at the root of the deployed site, which is what GitHub Pages requires.
- DNS: a `CNAME` record at the registrar for `archi.benjaminloschen.com` → `loschenbd.github.io`.
- After DNS propagates, manually toggle "Enforce HTTPS" in repo Pages settings. Let's Encrypt provisioning is automatic and usually takes a few minutes.

### Download CTA

The "Download for macOS" button links to:

```
https://github.com/loschenbd/archi/releases/latest/download/Archi-arm64.dmg
```

GitHub redirects this URL to whichever asset on the latest release matches that filename. As long as the electron-builder output is named `Archi-arm64.dmg` (or we rename the asset on upload to that pattern), the link always points to the newest signed `.dmg`. The implementation plan includes a step to verify the artifact name in `electron-builder.yml` matches.

A small "v0.1 · macOS 12+ · free & open source" meta line sits next to the CTA. The version is hardcoded in v1; a follow-up can fetch it from the GitHub API at build time if it becomes a maintenance burden.

## Page structure

In source order:

1. **Sticky nav** — Archi mark on the left; three text links on the right: "How it works" (anchors to that section), "Privacy" (anchors to the FAQ entry "Where does my data live?"), and "GitHub" (external link to the repo). A secondary download button mirrors the hero CTA but is hidden until the visitor scrolls past the hero — using `IntersectionObserver` against the hero element with a small inline script, since this is the one piece of interactivity on the page. Collapses to mark + download button only below `md`.
2. **Hero** — `h1` headline, lede paragraph, primary "Download for macOS" CTA, secondary "View on GitHub", meta line, and a static styled search demo (the same card shown in the brainstorm mockup) directly below the CTAs. Radial-gradient background using the app's exact tokens. No actual interactive search — it's a stylised preview.
3. **How it works** — three numbered steps in a horizontal flex (vertical stack on mobile):
   - **1. Connect your Kindle.** Plug it in over USB, or sign in to Kindle's web Notebook once. Archi takes it from there.
   - **2. Archi imports and dedupes locally.** Highlights and notes land in a local SQLite store. No servers. No upload.
   - **3. Search instantly — or send to Notion.** Full-text search across every book. One click sends any book (or your whole library) to Notion.
4. **Feature grid** — 3×2 grid of capability cards. Each card has a small inline icon, a short heading, and one sentence:
   - **Full-text search.** Find the line you're thinking of in milliseconds.
   - **Library view.** Every book you've highlighted, organised your way.
   - **Filter by book or letter.** Drill into a single title without losing your place.
   - **Send any book to Notion.** A Library database and a Passages database, structured cleanly.
   - **Idempotent sync.** Re-sync any time. Duplicates never appear.
   - **Local-first by design.** SQLite on disk. No telemetry. No accounts.
5. **Notion preview** — split layout. Left: a stylised Archi window showing a book's passages. Right: the resulting Notion Library and Passages databases (placeholder mock for v1; replaced with real screenshots once the implementation captures them). One-paragraph caption beneath explaining what's in each database.
6. **FAQ** — semantic `<details>`/`<summary>` accordion (no JS required). Initial questions:
   - "Do I need a Kindle device or just the app?"
   - "Does Archi work without Notion?"
   - "Why macOS only?"
   - "Is it free?"
   - "Where does my data live?"
   - "What's 'Cloud Notebook'? Is it required?"
7. **Footer** — Archi mark + one-line tagline on the left; columns of links on the right (Product: Download, How it works, FAQ. Project: GitHub, License, Releases). Bottom row: latest-version line, "Made by Ben Loschen," small copyright.

## Content polish and tone

- Restrained, slightly literary, never breathless. The app reads like a reader's companion; the site does too.
- No exclamation marks. No "supercharge," "unlock," "transform," "the future of."
- Headlines use Newsreader. Body uses Inter. The same hierarchy as the desktop app, scaled up for marketing.
- The hero copy is fixed in this spec ("Every Kindle highlight you've ever made. Finally searchable." / lede above). Other section copy is the implementation's draft; the user reviews on first build.

## Imagery

- **OG image** at `public/og-image.png`, 1200×630, generated as a static render of the hero treatment (or a simplified variant). One-time output committed to the repo; no build-time generation in v1.
- **Favicon** at `public/favicon.svg` and `favicon.ico`, derived from `apps/desktop/assets/icon.png`. The implementation plan includes a step to export at favicon sizes.
- **Screenshots** of `PassagesScreen`, `LibraryScreen`, and the Notion result. The implementation plan includes a step to capture these from the running app (at 2× retina, light scheme, with realistic content) into `apps/marketing/src/assets/screenshots/`. Until they exist, stylised HTML mockups fill the same slots so the design is never blocked.

## Accessibility

- All buttons and links keyboard-reachable. Focus rings inherit the app's `outline: 2px solid color-mix(...)` treatment.
- Headings are properly nested (`h1` in hero, `h2` per section, `h3` inside cards / FAQ summaries).
- Contrast ratios pass WCAG AA on all text/background pairs in the chosen palette — verified during build, not assumed.
- The accordion uses native `<details>` so it works without JavaScript and is screen-reader-friendly by default.
- All decorative SVGs marked `aria-hidden`; functional icons have `aria-label`s.

## Performance

- Astro emits static HTML. No JS on the critical path.
- Fonts loaded with `font-display: swap`. Only the weights actually used (Newsreader 500/600, Inter 400/500/600/700) are requested.
- All images served with explicit `width`/`height` to prevent CLS, and use Astro's `<Image>` component for automatic format negotiation (AVIF/WebP with PNG fallback) and responsive `srcset`.
- Tailwind's purge step removes unused utilities at build.

## Out of scope (explicit)

- Multi-page site, blog, docs portal, changelog page.
- Internationalisation.
- Email capture / waitlist forms.
- Analytics, tracking pixels, A/B testing.
- Dark mode.
- Intel-build button.
- Reusing components from `packages/ui`.
- Build-time fetch of latest release metadata. Version line is hardcoded in v1.
- A draft-preview Pages deployment per PR. Single environment, deploys on merge.

## Risks and mitigations

- **GitHub remote does not exist yet.** The site can be built and previewed locally, but the deploy workflow and the download/star links cannot function until `loschenbd/archi` is created on GitHub and this repo's remote is set. The implementation plan calls this out as a precondition with explicit setup steps.
- **DNS misconfiguration.** A wrong DNS record will leave the custom domain broken. The implementation plan includes a verification step (`dig archi.benjaminloschen.com`) before declaring deploy complete.
- **Asset filename drift.** If `electron-builder.yml` changes the `.dmg` artifact name, the hardcoded download URL silently 404s. Mitigation: the implementation plan verifies the artifact name matches the URL once at setup. If filenames need to vary, the follow-up is to fetch the asset URL via the GitHub Releases API at build time — explicitly deferred.
- **Font loading flash.** Newsreader is a less common typeface; loading from Google Fonts adds a network dependency. Mitigation: `font-display: swap`, preconnect to `fonts.gstatic.com`, and constrain to the exact weights needed.
- **Lighthouse score regression** if a future contributor adds React islands carelessly. Mitigation: the build script logs total JS bytes shipped; an obvious threshold violation is visible in CI logs without adding gating tests.

## Open questions deferred to implementation

- Final repo license file content (MIT vs Apache-2.0). The Footer's "License" link is wired in the design; the implementation plan picks the file.
- Exact wording of FAQ answers. The implementation drafts; the user edits during review on the first deployed build.
- Whether the Notion preview uses a real Notion screenshot (requires capturing one) or a stylised mock for v1. Default: stylised mock, to keep v1 unblocked.
