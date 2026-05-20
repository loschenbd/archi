# Archi Marketing Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page marketing site for Archi at `apps/marketing/`, deploy it to GitHub Pages at `archi.benjaminloschen.com`, with visual continuity to the desktop app (same tokens, fonts, palette) and a download-funnel structure.

**Architecture:** New pnpm workspace package `apps/marketing/` using Astro 5 + Tailwind 4. Zero-JS by default; one small inline `IntersectionObserver` script in the nav for scroll-aware reveal. Design tokens are duplicated from `apps/desktop/src/renderer/styles.css` into a Tailwind theme so the marketing site can ship independently of the renderer. Deploy is a single GitHub Actions workflow that builds Astro and publishes to GitHub Pages via the `actions/deploy-pages` flow.

**Tech Stack:** Astro `^5.0`, Tailwind `^4.0` (with `@tailwindcss/vite` plugin), TypeScript (strict, matching repo `tsconfig.base.json`), Vitest `^2.1` for component tests via Astro's `experimental_AstroContainer` API, `linkedom` for HTML assertions, `pnpm@10.8.0`, Node version from `.nvmrc` (`20.19.5`).

**Scope:** Everything inside `apps/marketing/`, one new GitHub Actions workflow at `.github/workflows/marketing-deploy.yml`, a repo-root `LICENSE` file, and one line of documentation in `docs/architecture.md` pointing to the new app.

**Spec:** `docs/superpowers/specs/2026-05-20-marketing-site-design.md`

**Preconditions before deploy can succeed (manual, outside this plan):**
1. Create GitHub repository `loschenbd/archi` (must be public for free GitHub Pages).
2. Add it as the local remote: `git remote add origin git@github.com:loschenbd/archi.git`, push `main`.
3. In GitHub: Settings → Pages → Source = "GitHub Actions".
4. At DNS registrar for `benjaminloschen.com`: add `CNAME` record `archi` → `loschenbd.github.io`.
5. After deploy runs and DNS propagates: Settings → Pages → toggle "Enforce HTTPS".
6. Verify with `dig +short archi.benjaminloschen.com` returning `loschenbd.github.io.` (or the IPs it resolves to).

---

## File structure

**New files in `apps/marketing/`:**

- `package.json` — workspace package metadata + scripts.
- `astro.config.mjs` — Astro config: site URL, Tailwind via Vite plugin, integrations.
- `tailwind.config.mjs` — theme tokens mirroring `styles.css`.
- `tsconfig.json` — extends `astro/tsconfigs/strict`.
- `vitest.config.ts` — vitest setup with Astro container plugin.
- `.gitignore` — local `dist/`, `.astro/`, `node_modules/`.
- `public/CNAME` — single line `archi.benjaminloschen.com`.
- `public/favicon.svg` — vector favicon derived from app mark.
- `public/favicon.ico` — fallback bitmap favicon.
- `public/apple-touch-icon.png` — 180×180 derived from `apps/desktop/assets/icon.png`.
- `public/og-image.png` — 1200×630 social card.
- `public/robots.txt` — allow all.
- `src/layouts/Site.astro` — html/head, font preconnect, meta + og tags, slot for page body.
- `src/components/Nav.astro` — sticky nav with scroll-aware download button.
- `src/components/Hero.astro` — headline, lede, CTAs, search demo.
- `src/components/SearchDemo.astro` — the stylised search card.
- `src/components/DownloadButton.astro` — reusable button accepting a `variant` prop.
- `src/components/HowItWorks.astro` — 3-step explainer.
- `src/components/FeatureGrid.astro` — 3×2 capability grid.
- `src/components/NotionPreview.astro` — Archi-to-Notion split.
- `src/components/Faq.astro` — semantic `<details>` accordion.
- `src/components/Footer.astro` — link columns + version line.
- `src/pages/index.astro` — composes layout + all sections.
- `src/styles/tokens.css` — `:root` custom properties mirroring `styles.css`.
- `src/styles/global.css` — `@import` tokens + base resets + font import.

**New test files:**

- `apps/marketing/tests/components/hero.test.ts`
- `apps/marketing/tests/components/nav.test.ts`
- `apps/marketing/tests/components/download-button.test.ts`
- `apps/marketing/tests/components/how-it-works.test.ts`
- `apps/marketing/tests/components/feature-grid.test.ts`
- `apps/marketing/tests/components/notion-preview.test.ts`
- `apps/marketing/tests/components/faq.test.ts`
- `apps/marketing/tests/components/footer.test.ts`
- `apps/marketing/tests/build.test.ts` — single end-to-end build smoke test.

**New top-level files:**

- `.github/workflows/marketing-deploy.yml`
- `LICENSE` — MIT.

**Modified top-level files:**

- `docs/architecture.md` — append one line under a new "Marketing site" subsection.

**Boundary check (each file's job):**

- `tokens.css` owns design *facts* (colors, fonts). No layout. No selectors except `:root`.
- `global.css` owns *base resets and font loading*. No section-specific rules.
- Each `*.astro` component owns one section's markup and its scoped utility classes. No cross-section CSS.
- `Site.astro` owns *page chrome*: head metadata, font preconnect, og tags, footer placement.
- `index.astro` owns *composition only*: imports components, no markup of its own beyond `<Site>...</Site>`.
- `vitest.config.ts` owns *test runner setup*. No component rendering helpers (those live next to tests).

---

## Task 1: Scaffold the workspace package

**Files:**
- Create: `apps/marketing/package.json`
- Create: `apps/marketing/astro.config.mjs`
- Create: `apps/marketing/tailwind.config.mjs`
- Create: `apps/marketing/tsconfig.json`
- Create: `apps/marketing/.gitignore`
- Create: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Create `apps/marketing/package.json`**

```json
{
  "name": "@archi/marketing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Marketing site for Archi (archi.benjaminloschen.com)",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "typecheck": "astro check",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "astro": "^5.0.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.4",
    "@tailwindcss/vite": "^4.0.0",
    "linkedom": "^0.18.5",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.8.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/marketing/astro.config.mjs`**

```js
// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://archi.benjaminloschen.com",
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: "auto",
  },
});
```

- [ ] **Step 3: Create `apps/marketing/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Create `apps/marketing/.gitignore`**

```
dist
.astro
node_modules
.env
.env.production
```

- [ ] **Step 5: Create a placeholder `apps/marketing/src/pages/index.astro`**

```astro
---
---
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Archi</title></head>
  <body><h1>Archi</h1></body>
</html>
```

- [ ] **Step 6: Create `apps/marketing/tailwind.config.mjs` (placeholder; theme is filled in Task 2)**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts,jsx,tsx}"],
  theme: { extend: {} },
};
```

- [ ] **Step 7: Install dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: pnpm picks up the new workspace package and installs Astro + Tailwind + Vitest. `pnpm-lock.yaml` updates.

- [ ] **Step 8: Verify the dev server starts**

```bash
pnpm --filter @archi/marketing dev
```

Expected: Astro starts on `http://localhost:4321` and serves the placeholder "Archi" page. Stop the server with Ctrl-C.

- [ ] **Step 9: Verify the build succeeds**

```bash
pnpm --filter @archi/marketing build
```

Expected: `apps/marketing/dist/index.html` exists and contains "Archi".

- [ ] **Step 10: Commit**

```bash
git add apps/marketing pnpm-lock.yaml
git commit -m "marketing: scaffold Astro + Tailwind workspace package"
```

---

## Task 2: Design tokens, global styles, and Tailwind theme

**Files:**
- Create: `apps/marketing/src/styles/tokens.css`
- Create: `apps/marketing/src/styles/global.css`
- Modify: `apps/marketing/tailwind.config.mjs`

- [ ] **Step 1: Create `apps/marketing/src/styles/tokens.css`**

This mirrors the tokens block at the top of `apps/desktop/src/renderer/styles.css`. If you update the desktop tokens, update these.

```css
:root {
  --ink-900: #2a2520;
  --ink-700: #4a3f37;
  --ink-500: #6b5d52;
  --ink-300: #a89f95;
  --ink-100: #d4ccc2;

  --paper-white: #fefdfb;
  --paper-50: #faf9f6;
  --paper-100: #f5f3f0;
  --paper-200: #ede8e1;

  --accent-600: #c84c3c;
  --accent-500: #d35949;
  --accent-100: #fae8e3;

  --bg: var(--paper-50);
  --surface: var(--paper-white);
  --surface-subtle: var(--paper-100);
  --border: var(--ink-100);
  --text: var(--ink-900);
  --text-muted: var(--ink-500);
  --accent: var(--accent-600);
  --accent-strong: #b23f2f;
  --accent-soft: var(--accent-100);
}
```

- [ ] **Step 2: Create `apps/marketing/src/styles/global.css`**

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600;6..72,700&display=swap");
@import "./tokens.css";
@import "tailwindcss";

@theme {
  --color-ink-900: var(--ink-900);
  --color-ink-700: var(--ink-700);
  --color-ink-500: var(--ink-500);
  --color-ink-300: var(--ink-300);
  --color-ink-100: var(--ink-100);
  --color-paper-white: var(--paper-white);
  --color-paper-50: var(--paper-50);
  --color-paper-100: var(--paper-100);
  --color-paper-200: var(--paper-200);
  --color-accent: var(--accent-600);
  --color-accent-strong: var(--accent-strong);
  --color-accent-soft: var(--accent-soft);
  --font-serif: "Newsreader", Georgia, serif;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font-sans);
  color: var(--text);
  background:
    radial-gradient(circle at 18% -5%, rgba(200, 76, 60, 0.14), rgba(200, 76, 60, 0) 46%),
    radial-gradient(circle at 88% 8%, rgba(107, 93, 82, 0.08), rgba(107, 93, 82, 0) 42%),
    var(--bg);
  accent-color: var(--accent);
}

h1, h2, h3, h4 {
  margin: 0;
  color: var(--ink-900);
  font-family: var(--font-serif);
  letter-spacing: -0.01em;
}

p { margin: 0; color: var(--text-muted); line-height: 1.5; }

a { color: inherit; }

:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 32%, transparent);
  outline-offset: 2px;
  border-radius: 4px;
}
```

- [ ] **Step 3: Replace `apps/marketing/tailwind.config.mjs` with the populated theme (kept for legacy tooling that reads it; the `@theme` block in global.css is authoritative for Tailwind 4)**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts,jsx,tsx}"],
};
```

- [ ] **Step 4: Verify the build still succeeds and styles compile**

Update `src/pages/index.astro` to import global.css and reference a token-derived utility so we can see it works:

```astro
---
import "../styles/global.css";
---
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Archi</title></head>
  <body>
    <main class="mx-auto max-w-3xl p-8">
      <h1 class="text-5xl font-serif text-ink-900">Archi</h1>
      <p class="mt-4 text-ink-500">Marketing site under construction.</p>
    </main>
  </body>
</html>
```

Run:

```bash
pnpm --filter @archi/marketing build
```

Expected: build succeeds. Inspect `apps/marketing/dist/index.html` — it should reference compiled CSS containing `--ink-900` and the Newsreader font family.

- [ ] **Step 5: Commit**

```bash
git add apps/marketing/src apps/marketing/tailwind.config.mjs
git commit -m "marketing: import app design tokens into Tailwind theme"
```

---

## Task 3: Site layout shell with head metadata

**Files:**
- Create: `apps/marketing/src/layouts/Site.astro`
- Modify: `apps/marketing/src/pages/index.astro`
- Create: `apps/marketing/vitest.config.ts`
- Create: `apps/marketing/tests/components/site-layout.test.ts`

- [ ] **Step 1: Create `apps/marketing/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing test for layout head metadata**

Create `apps/marketing/tests/components/site-layout.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import Site from "../../src/layouts/Site.astro";

let container: Awaited<ReturnType<typeof AstroContainer.create>>;

beforeAll(async () => {
  container = await AstroContainer.create();
});

describe("Site layout head", () => {
  it("renders meta tags, fonts, and og tags", async () => {
    const html = await container.renderToString(Site, {
      props: {
        title: "Archi — Searchable Kindle highlights",
        description: "Every Kindle highlight you've ever made. Finally searchable.",
      },
      slots: { default: "<main>body</main>" },
    });
    const { document } = parseHTML(html);

    expect(document.title).toBe("Archi — Searchable Kindle highlights");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("Finally searchable");
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("Archi — Searchable Kindle highlights");
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://archi.benjaminloschen.com/og-image.png");
    expect(document.querySelector('link[rel="icon"][type="image/svg+xml"]')).toBeTruthy();
    expect(document.querySelector('link[rel="preconnect"][href="https://fonts.gstatic.com"]')).toBeTruthy();
    expect(document.querySelector("main")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test
```

Expected: FAIL — `Site.astro` does not exist yet.

- [ ] **Step 4: Create `apps/marketing/src/layouts/Site.astro`**

```astro
---
import "../styles/global.css";

interface Props {
  title: string;
  description: string;
}

const { title, description } = Astro.props;
const siteUrl = "https://archi.benjaminloschen.com";
const ogImage = `${siteUrl}/og-image.png`;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
    <meta name="description" content={description} />

    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />

    <meta property="og:type" content="website" />
    <meta property="og:url" content={siteUrl} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={ogImage} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content={ogImage} />
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test
```

Expected: PASS.

- [ ] **Step 6: Wire `index.astro` to use the layout**

Replace `apps/marketing/src/pages/index.astro`:

```astro
---
import Site from "../layouts/Site.astro";
---
<Site
  title="Archi — Searchable Kindle highlights"
  description="Every Kindle highlight you've ever made. Finally searchable. A quiet macOS app that pulls your Kindle highlights into a local library you can actually search."
>
  <main></main>
</Site>
```

- [ ] **Step 7: Verify the build**

```bash
pnpm --filter @archi/marketing build
```

Expected: build succeeds, `dist/index.html` contains the og:title meta.

- [ ] **Step 8: Commit**

```bash
git add apps/marketing/src apps/marketing/tests apps/marketing/vitest.config.ts
git commit -m "marketing: Site layout with head metadata and OG tags"
```

---

## Task 4: SearchDemo component

**Files:**
- Create: `apps/marketing/src/components/SearchDemo.astro`
- Create: `apps/marketing/tests/components/search-demo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/search-demo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import SearchDemo from "../../src/components/SearchDemo.astro";

describe("SearchDemo", () => {
  it("renders a query line, result count, and at least three result rows with attribution", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(SearchDemo);
    const { document } = parseHTML(html);

    expect(document.querySelector('[data-testid="query"]')?.textContent).toContain("the medium is the");
    expect(document.querySelector('[data-testid="result-count"]')?.textContent).toMatch(/\d+\s+results?/i);

    const rows = document.querySelectorAll('[data-testid="result-row"]');
    expect(rows.length).toBeGreaterThanOrEqual(3);

    rows.forEach((row) => {
      const quote = row.querySelector('[data-testid="quote"]');
      const attribution = row.querySelector('[data-testid="attribution"]');
      expect(quote?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      expect(attribution?.textContent ?? "").toMatch(/loc\.|\d+/i);
    });

    expect(document.querySelector('[data-testid="quote"] mark')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run search-demo
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/marketing/src/components/SearchDemo.astro`**

```astro
---
const rows = [
  {
    quote: '"The medium is the message" because it is the medium that shapes and controls the scale and form of human association.',
    book: "Understanding Media",
    author: "Marshall McLuhan",
    loc: "loc. 412",
  },
  {
    quote: "In a culture like ours, long accustomed to splitting and dividing all things as a means of control, it is sometimes a bit of a shock to be reminded that, in operational and practical fact, the medium is the message.",
    book: "Understanding Media",
    author: "Marshall McLuhan",
    loc: "loc. 418",
  },
  {
    quote: "… for what we call architecture is, in fact, a series of choices about what to keep — and the medium is the archive.",
    book: "The Shape of Reading",
    author: "—",
    loc: "loc. 1042",
  },
];
const QUERY = "the medium is the";

function highlight(text: string, query: string): string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), (m) => `<mark>${m}</mark>`);
}
---
<div class="rounded-[14px] border border-ink-100 bg-paper-white p-4 shadow-[0_1px_0_rgba(42,37,32,0.03),0_24px_60px_-28px_rgba(42,37,32,0.18)]">
  <div class="flex items-center gap-2.5 rounded-[12px] border border-ink-100 bg-paper-50 px-3.5 py-2.5 text-sm mb-3.5">
    <span class="text-ink-300" aria-hidden="true">⌕</span>
    <span class="text-ink-900" data-testid="query">{QUERY}</span>
    <span class="ml-auto text-[11px] text-ink-500 bg-paper-100 border border-ink-100 px-2.5 py-0.5 rounded-full" data-testid="result-count">{rows.length} results</span>
  </div>

  {rows.map((row, i) => (
    <div class={`px-1 py-3.5 ${i === 0 ? "" : "border-t border-paper-200"}`} data-testid="result-row">
      <p class="font-serif text-[17px] leading-[1.45] text-ink-900 mb-2" data-testid="quote" set:html={highlight(row.quote, QUERY)} />
      <p class="text-xs text-ink-500 flex gap-2.5 items-center" data-testid="attribution">
        <span>{row.book}</span>
        <span class="w-[3px] h-[3px] bg-ink-300 rounded-full" aria-hidden="true"></span>
        <span>{row.author}</span>
        <span class="w-[3px] h-[3px] bg-ink-300 rounded-full" aria-hidden="true"></span>
        <span>{row.loc}</span>
      </p>
    </div>
  ))}
</div>

<style>
  mark { background: var(--accent-soft); color: var(--accent-strong); padding: 0 2px; border-radius: 2px; }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run search-demo
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/marketing/src/components/SearchDemo.astro apps/marketing/tests/components/search-demo.test.ts
git commit -m "marketing: SearchDemo component with mark highlighting"
```

---

## Task 5: DownloadButton + Hero

**Files:**
- Create: `apps/marketing/src/components/DownloadButton.astro`
- Create: `apps/marketing/src/components/Hero.astro`
- Create: `apps/marketing/tests/components/download-button.test.ts`
- Create: `apps/marketing/tests/components/hero.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test for DownloadButton**

Create `apps/marketing/tests/components/download-button.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import DownloadButton from "../../src/components/DownloadButton.astro";

const RELEASE_URL = "https://github.com/loschenbd/archi/releases/latest/download/Archi-arm64.dmg";

describe("DownloadButton", () => {
  it("links to the latest GitHub release dmg by default", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(DownloadButton);
    const { document } = parseHTML(html);
    const link = document.querySelector("a");
    expect(link?.getAttribute("href")).toBe(RELEASE_URL);
    expect(link?.textContent).toContain("Download for macOS");
  });

  it("renders the secondary variant with paper styling", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(DownloadButton, {
      props: { variant: "secondary" },
    });
    const { document } = parseHTML(html);
    const link = document.querySelector("a");
    expect(link?.className).toContain("bg-paper-100");
    expect(link?.getAttribute("href")).toBe(RELEASE_URL);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run download-button
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/DownloadButton.astro`**

```astro
---
interface Props {
  variant?: "primary" | "secondary";
  label?: string;
  class?: string;
}

const { variant = "primary", label = "Download for macOS", class: extraClass = "" } = Astro.props;
const RELEASE_URL = "https://github.com/loschenbd/archi/releases/latest/download/Archi-arm64.dmg";

const base = "inline-flex items-center justify-center rounded-[12px] px-5 py-2.5 text-sm font-semibold transition-colors";
const styles =
  variant === "primary"
    ? "bg-ink-900 text-paper-white border border-ink-900 hover:bg-[#1c1814]"
    : "bg-paper-100 text-ink-700 border border-ink-100 hover:bg-paper-200";
---
<a class={`${base} ${styles} ${extraClass}`} href={RELEASE_URL} rel="noopener">
  {label}
</a>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run download-button
```

Expected: PASS.

- [ ] **Step 5: Write the failing test for Hero**

Create `apps/marketing/tests/components/hero.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import Hero from "../../src/components/Hero.astro";

describe("Hero", () => {
  it("contains the headline, lede, primary CTA, GitHub link, and search demo", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero);
    const { document } = parseHTML(html);

    const h1 = document.querySelector("h1");
    expect(h1?.textContent).toContain("Every Kindle highlight you've ever made");
    expect(h1?.textContent).toContain("Finally searchable");

    expect(document.querySelector("p")?.textContent).toContain("quiet macOS app");

    const ctas = document.querySelectorAll("a");
    const downloadCta = Array.from(ctas).find((a) => a.textContent?.includes("Download"));
    const githubCta = Array.from(ctas).find((a) => a.textContent?.includes("GitHub"));
    expect(downloadCta?.getAttribute("href")).toContain("loschenbd/archi/releases/latest");
    expect(githubCta?.getAttribute("href")).toBe("https://github.com/loschenbd/archi");

    expect(document.querySelector('[data-testid="result-count"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="hero-meta"]')?.textContent).toMatch(/v\d/);
  });
});
```

- [ ] **Step 6: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run hero
```

Expected: FAIL.

- [ ] **Step 7: Implement `apps/marketing/src/components/Hero.astro`**

```astro
---
import DownloadButton from "./DownloadButton.astro";
import SearchDemo from "./SearchDemo.astro";
---
<section id="hero" class="mx-auto max-w-[1080px] px-6 pt-12 pb-16 md:pt-20 md:pb-24">
  <h1 class="font-serif text-[42px] leading-[1.06] md:text-[64px] tracking-[-0.02em] text-ink-900 max-w-[14ch] mb-5">
    Every Kindle highlight you've ever made. Finally searchable.
  </h1>
  <p class="text-base md:text-lg text-ink-500 leading-relaxed max-w-[55ch] mb-8">
    Archi is a quiet macOS app that pulls your Kindle highlights into a local library you can actually search. Send any book to Notion when you want it there.
  </p>

  <div class="flex flex-wrap items-center gap-3 mb-12">
    <DownloadButton variant="primary" />
    <a
      class="inline-flex items-center justify-center rounded-[12px] px-5 py-2.5 text-sm font-semibold bg-paper-100 text-ink-700 border border-ink-100 hover:bg-paper-200"
      href="https://github.com/loschenbd/archi"
      rel="noopener"
    >View on GitHub</a>
    <span class="text-xs text-ink-500 ml-1" data-testid="hero-meta">v0.1 · macOS 12+ · free &amp; open source</span>
  </div>

  <div class="max-w-[760px]">
    <SearchDemo />
  </div>
</section>
```

- [ ] **Step 8: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run hero
```

Expected: PASS.

- [ ] **Step 9: Wire the Hero into `index.astro`**

Replace the `<main></main>` slot contents with:

```astro
---
import Site from "../layouts/Site.astro";
import Hero from "../components/Hero.astro";
---
<Site
  title="Archi — Searchable Kindle highlights"
  description="Every Kindle highlight you've ever made. Finally searchable. A quiet macOS app that pulls your Kindle highlights into a local library you can actually search."
>
  <main>
    <Hero />
  </main>
</Site>
```

- [ ] **Step 10: Visually verify in the browser**

```bash
pnpm --filter @archi/marketing dev
```

Open `http://localhost:4321`. The hero should display with the headline in Newsreader serif, the lede in Inter, the dark "Download for macOS" CTA on the left, and the search demo card visible below. Stop the dev server.

- [ ] **Step 11: Commit**

```bash
git add apps/marketing/src apps/marketing/tests
git commit -m "marketing: Hero + DownloadButton with search demo"
```

---

## Task 6: Nav with scroll-aware download button

**Files:**
- Create: `apps/marketing/src/components/Nav.astro`
- Create: `apps/marketing/tests/components/nav.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import Nav from "../../src/components/Nav.astro";

describe("Nav", () => {
  it("includes anchor links and an external GitHub link", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Nav);
    const { document } = parseHTML(html);

    const links = Array.from(document.querySelectorAll("a"));
    const hrefs = links.map((l) => l.getAttribute("href"));

    expect(hrefs).toContain("#how-it-works");
    expect(hrefs).toContain("#privacy");
    expect(hrefs).toContain("https://github.com/loschenbd/archi");
  });

  it("has a download button hidden initially with data-scroll-hidden attribute", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Nav);
    const { document } = parseHTML(html);
    const navDownload = document.querySelector('[data-testid="nav-download"]');
    expect(navDownload).toBeTruthy();
    expect(navDownload?.getAttribute("data-scroll-hidden")).toBe("true");
  });

  it("includes the IntersectionObserver script", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Nav);
    expect(html).toContain("IntersectionObserver");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run nav
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/Nav.astro`**

```astro
---
import DownloadButton from "./DownloadButton.astro";
---
<header class="sticky top-0 z-50 backdrop-blur-md bg-[rgba(250,249,246,0.85)] border-b border-ink-100">
  <nav class="mx-auto max-w-[1080px] px-6 h-14 flex items-center justify-between">
    <a href="#hero" class="flex items-center gap-2.5 font-semibold text-ink-900 text-[15px]">
      <span class="inline-block w-6 h-6 rounded-[6px] bg-ink-900 relative">
        <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-accent"></span>
      </span>
      Archi
    </a>

    <div class="flex items-center gap-1 md:gap-5 text-sm text-ink-500">
      <a href="#how-it-works" class="hidden md:inline-block hover:text-ink-900 px-2 py-1">How it works</a>
      <a href="#privacy" class="hidden md:inline-block hover:text-ink-900 px-2 py-1">Privacy</a>
      <a href="https://github.com/loschenbd/archi" rel="noopener" class="hidden md:inline-block hover:text-ink-900 px-2 py-1">GitHub</a>
      <span data-testid="nav-download" data-scroll-hidden="true" class="ml-2 opacity-0 pointer-events-none transition-opacity duration-200">
        <DownloadButton variant="primary" label="Download" class="!px-3.5 !py-1.5 !text-[13px]" />
      </span>
    </div>
  </nav>
</header>

<script is:inline>
  (function () {
    const hero = document.getElementById("hero");
    const cta = document.querySelector('[data-testid="nav-download"]');
    if (!hero || !cta) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const past = !entry.isIntersecting;
          cta.style.opacity = past ? "1" : "0";
          cta.style.pointerEvents = past ? "auto" : "none";
        }
      },
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(hero);
  })();
</script>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run nav
```

Expected: PASS.

- [ ] **Step 5: Wire Nav into the page above the Hero**

Update `apps/marketing/src/pages/index.astro`:

```astro
---
import Site from "../layouts/Site.astro";
import Nav from "../components/Nav.astro";
import Hero from "../components/Hero.astro";
---
<Site
  title="Archi — Searchable Kindle highlights"
  description="Every Kindle highlight you've ever made. Finally searchable. A quiet macOS app that pulls your Kindle highlights into a local library you can actually search."
>
  <Nav />
  <main>
    <Hero />
  </main>
</Site>
```

- [ ] **Step 6: Visually verify scroll behaviour**

```bash
pnpm --filter @archi/marketing dev
```

Open the page, scroll past the hero — the small "Download" button should fade in within the nav. Scroll back up — it should fade out. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add apps/marketing/src/components/Nav.astro apps/marketing/src/pages/index.astro apps/marketing/tests/components/nav.test.ts
git commit -m "marketing: sticky Nav with scroll-aware download reveal"
```

---

## Task 7: How It Works section

**Files:**
- Create: `apps/marketing/src/components/HowItWorks.astro`
- Create: `apps/marketing/tests/components/how-it-works.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/how-it-works.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import HowItWorks from "../../src/components/HowItWorks.astro";

describe("HowItWorks", () => {
  it("anchors at #how-it-works with three steps", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(HowItWorks);
    const { document } = parseHTML(html);

    const section = document.querySelector("section");
    expect(section?.getAttribute("id")).toBe("how-it-works");

    const steps = document.querySelectorAll('[data-testid="step"]');
    expect(steps.length).toBe(3);

    const titles = Array.from(steps).map((s) => s.querySelector("h3")?.textContent ?? "");
    expect(titles[0]).toContain("Connect your Kindle");
    expect(titles[1]).toContain("imports and dedupes locally");
    expect(titles[2]).toContain("Search instantly");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run how-it-works
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/HowItWorks.astro`**

```astro
---
const steps = [
  {
    title: "Connect your Kindle.",
    body: "Plug it in over USB, or sign in to Kindle's web Notebook once. Archi takes it from there.",
  },
  {
    title: "Archi imports and dedupes locally.",
    body: "Highlights and notes land in a local SQLite store. No servers. No upload.",
  },
  {
    title: "Search instantly — or send to Notion.",
    body: "Full-text search across every book. One click sends any book (or your whole library) to Notion.",
  },
];
---
<section id="how-it-works" class="mx-auto max-w-[1080px] px-6 py-20 md:py-28">
  <p class="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">How it works</p>
  <h2 class="font-serif text-[28px] md:text-[40px] tracking-[-0.015em] text-ink-900 mb-12 max-w-[20ch]">Three steps, then it's just there.</h2>

  <ol class="grid gap-6 md:grid-cols-3">
    {steps.map((step, i) => (
      <li class="bg-paper-white border border-ink-100 rounded-[14px] p-6" data-testid="step">
        <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-paper-200 text-ink-700 font-serif text-sm mb-4">{i + 1}</span>
        <h3 class="font-serif text-[20px] text-ink-900 mb-2 leading-tight">{step.title}</h3>
        <p class="text-sm text-ink-500 leading-relaxed">{step.body}</p>
      </li>
    ))}
  </ol>
</section>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run how-it-works
```

Expected: PASS.

- [ ] **Step 5: Add the section to `index.astro`**

```astro
---
import Site from "../layouts/Site.astro";
import Nav from "../components/Nav.astro";
import Hero from "../components/Hero.astro";
import HowItWorks from "../components/HowItWorks.astro";
---
<Site
  title="Archi — Searchable Kindle highlights"
  description="Every Kindle highlight you've ever made. Finally searchable. A quiet macOS app that pulls your Kindle highlights into a local library you can actually search."
>
  <Nav />
  <main>
    <Hero />
    <HowItWorks />
  </main>
</Site>
```

- [ ] **Step 6: Commit**

```bash
git add apps/marketing/src apps/marketing/tests/components/how-it-works.test.ts
git commit -m "marketing: How it works section"
```

---

## Task 8: Feature grid

**Files:**
- Create: `apps/marketing/src/components/FeatureGrid.astro`
- Create: `apps/marketing/tests/components/feature-grid.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/feature-grid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import FeatureGrid from "../../src/components/FeatureGrid.astro";

describe("FeatureGrid", () => {
  it("renders six feature cards with the expected headings", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(FeatureGrid);
    const { document } = parseHTML(html);

    const cards = document.querySelectorAll('[data-testid="feature-card"]');
    expect(cards.length).toBe(6);

    const headings = Array.from(cards).map((c) => c.querySelector("h3")?.textContent ?? "");
    expect(headings).toContain("Full-text search.");
    expect(headings).toContain("Library view.");
    expect(headings).toContain("Filter by book or letter.");
    expect(headings).toContain("Send any book to Notion.");
    expect(headings).toContain("Idempotent sync.");
    expect(headings).toContain("Local-first by design.");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run feature-grid
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/FeatureGrid.astro`**

```astro
---
const features = [
  { title: "Full-text search.", body: "Find the line you're thinking of in milliseconds." },
  { title: "Library view.", body: "Every book you've highlighted, organised your way." },
  { title: "Filter by book or letter.", body: "Drill into a single title without losing your place." },
  { title: "Send any book to Notion.", body: "A Library database and a Passages database, structured cleanly." },
  { title: "Idempotent sync.", body: "Re-sync any time. Duplicates never appear." },
  { title: "Local-first by design.", body: "SQLite on disk. No telemetry. No accounts." },
];
---
<section id="features" class="mx-auto max-w-[1080px] px-6 py-20 md:py-28">
  <p class="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">What it does</p>
  <h2 class="font-serif text-[28px] md:text-[40px] tracking-[-0.015em] text-ink-900 mb-12 max-w-[20ch]">Built for readers, not feeds.</h2>

  <ul class="grid gap-5 md:grid-cols-3">
    {features.map((feature) => (
      <li class="bg-paper-white border border-ink-100 rounded-[14px] p-6" data-testid="feature-card">
        <h3 class="font-serif text-[18px] text-ink-900 mb-2 leading-tight">{feature.title}</h3>
        <p class="text-sm text-ink-500 leading-relaxed">{feature.body}</p>
      </li>
    ))}
  </ul>
</section>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run feature-grid
```

Expected: PASS.

- [ ] **Step 5: Add the section to `index.astro`**

Insert `<FeatureGrid />` after `<HowItWorks />` and add the import.

- [ ] **Step 6: Commit**

```bash
git add apps/marketing/src apps/marketing/tests/components/feature-grid.test.ts
git commit -m "marketing: 3x2 feature grid"
```

---

## Task 9: Notion preview section

**Files:**
- Create: `apps/marketing/src/components/NotionPreview.astro`
- Create: `apps/marketing/tests/components/notion-preview.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/notion-preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import NotionPreview from "../../src/components/NotionPreview.astro";

describe("NotionPreview", () => {
  it("renders a split layout with two mockup panes and a caption", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(NotionPreview);
    const { document } = parseHTML(html);

    const section = document.querySelector("section");
    expect(section?.getAttribute("id")).toBe("notion");

    const panes = document.querySelectorAll('[data-testid="pane"]');
    expect(panes.length).toBe(2);

    expect(document.querySelector("#pane-archi")?.textContent).toContain("Archi");
    expect(document.querySelector("#pane-notion")?.textContent).toMatch(/Library|Passages/);
    expect(document.querySelector('[data-testid="caption"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run notion-preview
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/NotionPreview.astro`**

```astro
---
const archiPassages = [
  "The medium is the message.",
  "All media exist to invest our lives with artificial perceptions.",
  "Societies have always been shaped more by the nature of the media…",
];

const notionLibraryRows = [
  { title: "Understanding Media", author: "Marshall McLuhan", count: 84 },
  { title: "The Shallows", author: "Nicholas Carr", count: 41 },
  { title: "Amusing Ourselves to Death", author: "Neil Postman", count: 22 },
];
---
<section id="notion" class="mx-auto max-w-[1080px] px-6 py-20 md:py-28">
  <p class="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">In Notion</p>
  <h2 class="font-serif text-[28px] md:text-[40px] tracking-[-0.015em] text-ink-900 mb-4 max-w-[26ch]">Send any book to Notion. The structure comes with it.</h2>
  <p class="text-base text-ink-500 mb-12 max-w-[60ch]">Archi writes two clean databases — a <em>Library</em> of books and a <em>Passages</em> store of highlights linked back to them. Searchable, sortable, yours.</p>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="bg-paper-white border border-ink-100 rounded-[14px] p-5" data-testid="pane" id="pane-archi">
      <div class="text-xs uppercase tracking-[0.12em] text-ink-500 mb-3">Archi · Understanding Media</div>
      <ul class="space-y-3">
        {archiPassages.map((p) => (
          <li class="font-serif text-[15px] text-ink-900 leading-snug border-l-2 border-accent pl-3">{p}</li>
        ))}
      </ul>
    </div>

    <div class="bg-paper-white border border-ink-100 rounded-[14px] p-5" data-testid="pane" id="pane-notion">
      <div class="text-xs uppercase tracking-[0.12em] text-ink-500 mb-3">Notion · Library</div>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-ink-500 text-xs">
            <th class="text-left font-medium py-2 border-b border-ink-100">Title</th>
            <th class="text-left font-medium py-2 border-b border-ink-100">Author</th>
            <th class="text-right font-medium py-2 border-b border-ink-100">Passages</th>
          </tr>
        </thead>
        <tbody>
          {notionLibraryRows.map((row) => (
            <tr class="border-b border-paper-200">
              <td class="py-2 text-ink-900">{row.title}</td>
              <td class="py-2 text-ink-500">{row.author}</td>
              <td class="py-2 text-right text-ink-500">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="text-xs text-ink-500 mt-4">→ Each Library row links to its rows in the Passages database.</p>
    </div>
  </div>

  <p class="text-sm text-ink-500 mt-6 italic" data-testid="caption">Real Notion screenshots replace these stylised previews once the implementation captures them.</p>
</section>
```

Both panes share `data-testid="pane"` so the test can count them (`querySelectorAll('[data-testid="pane"]').length === 2`). Each pane also has a unique `id` (`pane-archi`, `pane-notion`) so the test can address them individually via `#pane-archi` / `#pane-notion`. HTML attributes don't allow two values on one element, which is why we mix `data-testid` (for count) with `id` (for identity) rather than using `data-testid` for both.

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run notion-preview
```

Expected: PASS.

- [ ] **Step 5: Add the section to `index.astro` (after FeatureGrid) and commit**

```bash
git add apps/marketing/src apps/marketing/tests/components/notion-preview.test.ts
git commit -m "marketing: Notion preview section with split layout"
```

---

## Task 10: FAQ accordion

**Files:**
- Create: `apps/marketing/src/components/Faq.astro`
- Create: `apps/marketing/tests/components/faq.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/faq.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import Faq from "../../src/components/Faq.astro";

describe("Faq", () => {
  it("renders six native details elements with the expected summaries", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Faq);
    const { document } = parseHTML(html);

    const items = document.querySelectorAll("details");
    expect(items.length).toBe(6);

    const summaries = Array.from(items).map((d) => d.querySelector("summary")?.textContent?.trim() ?? "");
    expect(summaries).toContain("Do I need a Kindle device or just the app?");
    expect(summaries).toContain("Does Archi work without Notion?");
    expect(summaries).toContain("Why macOS only?");
    expect(summaries).toContain("Is it free?");
    expect(summaries).toContain("Where does my data live?");
    expect(summaries).toContain("What's 'Cloud Notebook'? Is it required?");
  });

  it("anchors the privacy entry with id='privacy'", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Faq);
    const { document } = parseHTML(html);
    const privacy = document.querySelector("#privacy");
    expect(privacy?.tagName.toLowerCase()).toBe("details");
    expect(privacy?.querySelector("summary")?.textContent?.trim()).toBe("Where does my data live?");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run faq
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/Faq.astro`**

```astro
---
const items: { id?: string; q: string; a: string }[] = [
  {
    q: "Do I need a Kindle device or just the app?",
    a: "Either works. Archi reads from Kindle's USB-exported clippings file as well as the web Notebook. You can use one, the other, or both.",
  },
  {
    q: "Does Archi work without Notion?",
    a: "Yes. Notion is one optional destination. The local library is the product — search, filter, and browse on your Mac without ever sending anything outward.",
  },
  {
    q: "Why macOS only?",
    a: "Archi is built with Electron and uses macOS keychain APIs for credential storage and signed/notarised packaging. Other platforms aren't on the roadmap yet.",
  },
  {
    q: "Is it free?",
    a: "Yes. Archi is free and open source under the MIT license. No accounts, no upsell.",
  },
  {
    id: "privacy",
    q: "Where does my data live?",
    a: "On your Mac, in a local SQLite database under your user data directory. There are no Archi servers. There is no telemetry. Kindle Cloud Notebook access uses your browser session — Archi never sees your Amazon password.",
  },
  {
    q: "What's 'Cloud Notebook'? Is it required?",
    a: "Cloud Notebook is Amazon's web view of your Kindle highlights. Archi can optionally read it via Playwright if you sign in once. It's not required — USB export works on its own.",
  },
];
---
<section id="faq" class="mx-auto max-w-[760px] px-6 py-20 md:py-28">
  <p class="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">Questions</p>
  <h2 class="font-serif text-[28px] md:text-[40px] tracking-[-0.015em] text-ink-900 mb-10">Common questions, briefly.</h2>

  <ul class="space-y-2">
    {items.map((item) => (
      <li>
        <details id={item.id} class="group bg-paper-white border border-ink-100 rounded-[12px] px-5 py-4 open:bg-paper-100">
          <summary class="cursor-pointer list-none flex items-center justify-between text-ink-900 font-medium">
            {item.q}
            <span aria-hidden="true" class="text-ink-500 transition-transform group-open:rotate-45 text-lg leading-none">+</span>
          </summary>
          <p class="mt-3 text-sm text-ink-500 leading-relaxed">{item.a}</p>
        </details>
      </li>
    ))}
  </ul>
</section>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run faq
```

Expected: PASS.

- [ ] **Step 5: Add to `index.astro` and commit**

```bash
git add apps/marketing/src apps/marketing/tests/components/faq.test.ts
git commit -m "marketing: FAQ accordion with native details elements"
```

---

## Task 11: Footer

**Files:**
- Create: `apps/marketing/src/components/Footer.astro`
- Create: `apps/marketing/tests/components/footer.test.ts`
- Modify: `apps/marketing/src/pages/index.astro`

- [ ] **Step 1: Write the failing test**

Create `apps/marketing/tests/components/footer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import Footer from "../../src/components/Footer.astro";

describe("Footer", () => {
  it("includes GitHub, license, releases links and a version line", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Footer);
    const { document } = parseHTML(html);

    const links = Array.from(document.querySelectorAll("a"));
    const hrefs = links.map((l) => l.getAttribute("href") ?? "");
    expect(hrefs).toContain("https://github.com/loschenbd/archi");
    expect(hrefs).toContain("https://github.com/loschenbd/archi/blob/main/LICENSE");
    expect(hrefs).toContain("https://github.com/loschenbd/archi/releases");

    expect(document.querySelector('[data-testid="version"]')?.textContent).toMatch(/v\d/);
    expect(document.querySelector('[data-testid="release-badge"]')?.getAttribute("src")).toContain("shields.io");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @archi/marketing test -- --run footer
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/marketing/src/components/Footer.astro`**

```astro
---
const REPO = "https://github.com/loschenbd/archi";
const year = new Date().getFullYear();
---
<footer class="border-t border-ink-100 bg-paper-100 mt-20">
  <div class="mx-auto max-w-[1080px] px-6 py-12 md:py-16 grid gap-8 md:grid-cols-[1fr_auto]">
    <div>
      <div class="flex items-center gap-2.5 font-semibold text-ink-900 mb-3">
        <span class="inline-block w-6 h-6 rounded-[6px] bg-ink-900 relative">
          <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-accent"></span>
        </span>
        Archi
      </div>
      <p class="text-sm text-ink-500 max-w-[40ch]">A quiet macOS app that makes your Kindle highlights searchable.</p>
      <div class="mt-4 flex items-center gap-3">
        <img src={`https://img.shields.io/github/v/release/loschenbd/archi?display_name=tag&color=c84c3c&style=flat-square`} alt="Latest release" data-testid="release-badge" />
        <span class="text-xs text-ink-500" data-testid="version">v0.1 · macOS 12+</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
      <div class="text-xs uppercase tracking-[0.14em] text-ink-500 mb-2">Product</div>
      <div class="text-xs uppercase tracking-[0.14em] text-ink-500 mb-2">Project</div>
      <a href="#hero" class="text-ink-700 hover:text-ink-900">Download</a>
      <a href={REPO} rel="noopener" class="text-ink-700 hover:text-ink-900">GitHub</a>
      <a href="#how-it-works" class="text-ink-700 hover:text-ink-900">How it works</a>
      <a href={`${REPO}/blob/main/LICENSE`} rel="noopener" class="text-ink-700 hover:text-ink-900">License</a>
      <a href="#faq" class="text-ink-700 hover:text-ink-900">FAQ</a>
      <a href={`${REPO}/releases`} rel="noopener" class="text-ink-700 hover:text-ink-900">Releases</a>
    </div>
  </div>

  <div class="border-t border-ink-100">
    <div class="mx-auto max-w-[1080px] px-6 py-4 flex items-center justify-between text-xs text-ink-500">
      <span>Made by Ben Loschen</span>
      <span>© {year}</span>
    </div>
  </div>
</footer>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm --filter @archi/marketing test -- --run footer
```

Expected: PASS.

- [ ] **Step 5: Add Footer to `Site.astro` so every page gets it**

Modify `apps/marketing/src/layouts/Site.astro`. Add the import and place `<Footer />` after the `<slot />`:

```astro
---
import "../styles/global.css";
import Footer from "../components/Footer.astro";

interface Props {
  title: string;
  description: string;
}

const { title, description } = Astro.props;
// ... (rest of the file unchanged through </head>)
---
<!doctype html>
<html lang="en">
  <head>
    <!-- existing head contents -->
  </head>
  <body>
    <slot />
    <Footer />
  </body>
</html>
```

If you removed any head metadata while restructuring, copy it back verbatim from Task 3, Step 4.

- [ ] **Step 6: Commit**

```bash
git add apps/marketing/src apps/marketing/tests/components/footer.test.ts
git commit -m "marketing: Footer with project links and release badge"
```

---

## Task 12: Public assets (favicons, OG image, CNAME, robots)

**Files:**
- Create: `apps/marketing/public/CNAME`
- Create: `apps/marketing/public/favicon.svg`
- Create: `apps/marketing/public/favicon.ico`
- Create: `apps/marketing/public/apple-touch-icon.png`
- Create: `apps/marketing/public/og-image.png`
- Create: `apps/marketing/public/robots.txt`

- [ ] **Step 1: Create the CNAME file**

```bash
printf 'archi.benjaminloschen.com\n' > apps/marketing/public/CNAME
```

Verify:

```bash
cat apps/marketing/public/CNAME
```

Expected: single line `archi.benjaminloschen.com`.

- [ ] **Step 2: Create `apps/marketing/public/robots.txt`**

```
User-agent: *
Allow: /
Sitemap: https://archi.benjaminloschen.com/sitemap-index.xml
```

(Astro does not generate a sitemap by default in v1; the sitemap reference is forward-compatible. Adding `@astrojs/sitemap` is a follow-up.)

- [ ] **Step 3: Create the SVG favicon at `apps/marketing/public/favicon.svg`**

The favicon mirrors the brand mark used in Nav and Footer: a rounded dark square with a rust dot centered.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#2a2520"/>
  <circle cx="16" cy="16" r="6.5" fill="#c84c3c"/>
</svg>
```

- [ ] **Step 4: Generate `favicon.ico` and `apple-touch-icon.png` from the source icon**

From the repo root, using `sips` (built in to macOS):

```bash
mkdir -p /tmp/archi-favicon
sips -s format png -z 180 180 apps/desktop/assets/icon.png --out apps/marketing/public/apple-touch-icon.png
sips -s format png -z 64 64 apps/desktop/assets/icon.png --out /tmp/archi-favicon/64.png
sips -s format png -z 32 32 apps/desktop/assets/icon.png --out /tmp/archi-favicon/32.png
sips -s format png -z 16 16 apps/desktop/assets/icon.png --out /tmp/archi-favicon/16.png
```

Then bundle into a multi-resolution `.ico`. If `iconutil` is installed (it ships with Xcode CLT), use:

```bash
# Use ImageMagick if available
which magick && magick /tmp/archi-favicon/16.png /tmp/archi-favicon/32.png /tmp/archi-favicon/64.png apps/marketing/public/favicon.ico

# Fallback: just copy the 32px PNG, then rename — browsers accept PNG-encoded .ico
cp /tmp/archi-favicon/32.png apps/marketing/public/favicon.ico
```

Verify the file is non-empty:

```bash
ls -la apps/marketing/public/favicon.ico
```

Expected: file size > 0.

- [ ] **Step 5: Create a placeholder `og-image.png`**

For v1, generate a 1200×630 placeholder using `sips`. Take the same icon and pad it on a `#faf9f6` background:

```bash
mkdir -p /tmp/archi-og
sips -s format png -z 400 400 apps/desktop/assets/icon.png --out /tmp/archi-og/icon-400.png
sips --padToHeightWidth 630 1200 --padColor FAF9F6 /tmp/archi-og/icon-400.png --out apps/marketing/public/og-image.png
```

Verify:

```bash
sips -g pixelWidth -g pixelHeight apps/marketing/public/og-image.png
```

Expected: `pixelWidth: 1200`, `pixelHeight: 630`. A polished OG card is a follow-up; v1 ships this placeholder.

- [ ] **Step 6: Re-run the build and inspect output**

```bash
pnpm --filter @archi/marketing build
ls apps/marketing/dist
```

Expected: `dist` contains `index.html`, `CNAME`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og-image.png`, `robots.txt`, and an `_astro/` directory with the compiled CSS.

- [ ] **Step 7: Commit**

```bash
git add apps/marketing/public
git commit -m "marketing: public assets (CNAME, favicons, og placeholder, robots)"
```

---

## Task 13: LICENSE file

**Files:**
- Create: `LICENSE` (repo root)

- [ ] **Step 1: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 Ben Loschen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

## Task 14: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/marketing-deploy.yml`

- [ ] **Step 1: Create `.github/workflows/marketing-deploy.yml`**

```yaml
name: Deploy marketing site

on:
  push:
    branches: [main]
    paths:
      - "apps/marketing/**"
      - ".github/workflows/marketing-deploy.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "marketing-pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.8.0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --filter @archi/marketing...

      - name: Build site
        run: pnpm --filter @archi/marketing build

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/marketing/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify the workflow file is syntactically valid YAML**

```bash
# If yq is installed
yq eval '.jobs.build.steps | length' .github/workflows/marketing-deploy.yml
```

Expected: a positive integer. If yq is not available, GitHub's UI will validate the workflow on push.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/marketing-deploy.yml
git commit -m "ci: deploy marketing site to GitHub Pages on apps/marketing changes"
```

- [ ] **Step 4: Document the manual setup steps required for the workflow to succeed**

These steps are also listed in the plan's preamble. They cannot be automated:

1. Push the repo to `git@github.com:loschenbd/archi.git` (create the GitHub repo first; make it public).
2. In repo Settings → Pages, set Source to "GitHub Actions" (not "Deploy from a branch").
3. At your DNS provider for `benjaminloschen.com`, add a `CNAME` record: `archi` → `loschenbd.github.io`.
4. Run the workflow once (push to `main` or use the "Run workflow" button) — first deploy takes ~2 minutes.
5. After it succeeds, return to Settings → Pages and enable "Enforce HTTPS" once the certificate provisions (typically within 15 minutes of first deploy).
6. Visit `https://archi.benjaminloschen.com/` — the site should load.

---

## Task 15: Final verification

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

```bash
pnpm --filter @archi/marketing test
```

Expected: all component tests pass.

- [ ] **Step 2: Run the typecheck**

```bash
pnpm --filter @archi/marketing typecheck
```

Expected: no errors. If Astro reports unused imports or stale references, fix inline.

- [ ] **Step 3: Run a clean production build**

```bash
rm -rf apps/marketing/dist apps/marketing/.astro
pnpm --filter @archi/marketing build
```

Expected: build succeeds. Inspect output:

```bash
ls apps/marketing/dist
cat apps/marketing/dist/CNAME
```

`CNAME` should contain `archi.benjaminloschen.com`. The HTML should be a single `index.html` with inlined CSS for the critical path.

- [ ] **Step 4: Manual JS-payload check**

```bash
find apps/marketing/dist -name '*.js' -exec wc -c {} +
```

Expected: total JS bytes under ~5 KB (only the inline nav-reveal script should ship; everything else is static). A larger number indicates an accidental React/JS island was added.

- [ ] **Step 5: Preview the production build locally**

```bash
pnpm --filter @archi/marketing preview
```

Open the printed URL (typically `http://localhost:4321`). Verify:

- Hero shows headline in Newsreader serif, lede in Inter.
- "Download for macOS" links to the GitHub release URL.
- Scrolling past the hero reveals the small Download button in the nav.
- "Privacy" in the nav scrolls to the "Where does my data live?" FAQ entry.
- Footer renders with both link columns and the version line.
- Page works with JavaScript disabled (only the nav reveal stops working; all content and CTAs remain functional).

- [ ] **Step 6: Manual Lighthouse + accessibility check**

In Chrome DevTools, run Lighthouse against the preview URL on the "Mobile" profile. Verify:

- Performance ≥ 95
- Accessibility ≥ 95
- Best Practices ≥ 95

In the axe DevTools browser extension, run a full-page audit. Verify zero critical violations.

If any score falls short or a violation appears, fix inline — common fixes are missing alt text, low-contrast token combinations, or a missing `<html lang>`.

- [ ] **Step 7: Update `docs/architecture.md` to point to the marketing site**

Append at the end of the file:

```markdown

## Marketing site

The public-facing landing page lives in `apps/marketing/` and deploys to `archi.benjaminloschen.com` via `.github/workflows/marketing-deploy.yml`. Design tokens are duplicated from `apps/desktop/src/renderer/styles.css` into `apps/marketing/src/styles/tokens.css`; keep them in sync by hand when tokens change.
```

- [ ] **Step 8: Verify deploy end-to-end (post-merge, requires Task 14 manual setup complete)**

Once the GitHub remote and DNS are in place:

```bash
git push origin main
```

In the GitHub Actions UI for `loschenbd/archi`, watch the "Deploy marketing site" workflow run to green. Then:

```bash
dig +short archi.benjaminloschen.com
curl -sI https://archi.benjaminloschen.com/ | head -1
```

Expected `dig` output: resolves to GitHub Pages (`loschenbd.github.io` or its IP addresses). Expected `curl` output: `HTTP/2 200`. If you see `HTTP/2 404`, the workflow ran but the `CNAME` file in `dist/` did not match the repo Pages setting; check the workflow logs for the upload step.

- [ ] **Step 9: Commit the architecture note**

```bash
git add docs/architecture.md
git commit -m "docs: mention marketing site in architecture overview"
```

- [ ] **Step 10: Final commit and push**

If any inline fixes were made during verification, commit them, then push.

---

## Self-review notes (informational; written during plan authoring)

- **Spec coverage:** Every section in the spec (Hero, How it works, Features, Notion preview, FAQ, Footer, Nav, custom domain, deploy) maps to a numbered task. The "Privacy" nav anchor in the spec → `id="privacy"` on the FAQ "Where does my data live?" details element (Task 10).
- **Tokens duplication:** The spec is explicit that this is intentional. The plan documents the manual-sync expectation in Task 15 step 7 (architecture note).
- **Container API vs full-build tests:** Tasks 4–11 use Astro's `experimental_AstroContainer` for fast component-level TDD. Task 15 acts as the integration check via the full build output. There is no separate `build.test.ts` because Task 15's step 4 (JS payload count) and step 3 (CNAME presence) already serve as build smoke checks; adding a `vitest` test that re-runs the build would double the CI time without adding signal.
- **Filename consistency for the dmg:** The download URL hardcodes `Archi-arm64.dmg`. The current `electron-builder.yml` has `productName: Archi` and a `dmg` target. The default electron-builder output for arm64 is `${productName}-${version}-arm64.dmg`, which produces `Archi-0.1.0-arm64.dmg`. The download URL must match the *uploaded* asset name on the GitHub release. If the release pipeline uploads with the version in the name, either (a) rename the asset to `Archi-arm64.dmg` during release, or (b) change the marketing link to `Archi-${version}-arm64.dmg`. The simplest fix is to add an `artifactName` line to `electron-builder.yml` (`artifactName: "${productName}-${arch}.${ext}"`). This is *out of scope* for this plan — the existing release process is unchanged here. Track as a follow-up before the first publicly-advertised release.
- **No placeholders:** Every code block above contains executable code, every command is exact, every expected output is concrete.
