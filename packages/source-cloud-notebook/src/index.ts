import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  validate,
  dumpAuthArtifactsState,
  parseStorageStateCookies,
  filterNewCookies,
  type CloudValidationReport,
  type ValidationPhase
} from "./validation-report.js";
import { computeBookFingerprint, decideBookAction, FINGERPRINT_FIRST_ID_LIMIT } from "./fingerprint.js";

export type CloudConnectorStatus = "connected" | "needs_auth" | "reconnected";

export type CloudPassage = {
  externalPassageId: string;
  externalBookId?: string;
  storeIdentifier?: string;
  coverImageUrl?: string;
  title: string;
  creator?: string;
  body: string;
  note?: string;
  positionStart?: string;
  positionEnd?: string;
  positionKind?: "page" | "location" | "unknown";
  markedAt?: string;
};

export type CloudBookFingerprint = string;

export type CloudFetchStats = {
  totalBooks: number;
  scannedBooks: number;
  skippedBooks: number;
  rowsSeen: number;
  rowsAccepted: number;
  passagesDiscovered: number;
  fingerprintSkippedBooks: number;
  fingerprintChangedBooks: number;
};

export type CloudFetchResult = {
  cursor?: string;
  passages: CloudPassage[];
  fingerprints: Map<string, CloudBookFingerprint>;
  fetchedBookIds: string[];
  skippedByFingerprintBookIds: string[];
  sidebarBookIds: string[];
  stats: CloudFetchStats;
};

type CloudLibraryBook = {
  id: string;
  storeIdentifier?: string;
  title?: string;
  creator?: string;
  coverImageUrl?: string;
};

export function decodeKindleHighlightLocation(
  rawId: string | undefined
): { positionStart: string; positionKind: "location" } | null {
  if (typeof rawId !== "string") {
    return null;
  }
  const trimmed = rawId.trim();
  if (!trimmed) {
    return null;
  }
  const separatorIndex = trimmed.lastIndexOf("::");
  const encoded = separatorIndex === -1 ? trimmed : trimmed.slice(separatorIndex + 2);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded || !/^[\x20-\x7e]+$/.test(decoded)) {
    return null;
  }
  const fields = decoded.split(":");
  if (fields.length < 3) {
    return null;
  }
  const location = fields[2];
  if (!location || !/^\d+$/.test(location)) {
    return null;
  }
  return { positionStart: location, positionKind: "location" };
}

export function normalizeNotebookCandidate(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function looksLikeNotebookMetadataTitle(value: string | undefined): boolean {
  const normalized = normalizeNotebookCandidate(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("highlight") ||
    normalized.startsWith("page ") ||
    normalized.startsWith("location ") ||
    normalized.startsWith("location:") ||
    normalized.startsWith("loc ") ||
    normalized.startsWith("loc:") ||
    normalized.startsWith("note ")
  );
}

export function resolveReadableNotebookTitle(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeNotebookCandidate(candidate);
    if (!normalized) {
      continue;
    }
    if (looksLikeNotebookMetadataTitle(normalized)) {
      continue;
    }
    if (/^[A-Z0-9]{10}$/i.test(normalized)) {
      continue;
    }
    return normalized;
  }
  return undefined;
}

export type CloudFetchOptions = {
  signal?: AbortSignal;
  knownFingerprints?: Map<string, CloudBookFingerprint>;
  forceFullSweep?: boolean;
};

export type CloudCachedStatus = {
  status: CloudConnectorStatus;
  validatedAtMs: number | null;
};

export interface CloudNotebookConnector {
  getStatus(): Promise<CloudConnectorStatus>;
  getCachedStatus(): CloudCachedStatus;
  reconnect(): Promise<void>;
  fetchSince(cursor?: string, options?: CloudFetchOptions): Promise<CloudFetchResult>;
  validateViaNet?(): Promise<CloudConnectorStatus | null>;
}

export type CloudBookDiscovery = {
  book?: {
    id: string;
    storeIdentifier?: string;
    title?: string;
    creator?: string;
    coverImageUrl?: string;
  };
  passages: CloudPassage[];
};

export type ChromiumMode = "legacy_headless" | "new_headless" | "offscreen_headed" | "headed_visible";

/**
 * Cheap, headless-undetectable status validator. Implementations make a
 * single authenticated HTTP request to the notebook URL and infer
 * connection state from the response (200 + notebook markers → connected;
 * 3xx redirect to signin → needs_auth). The Electron-based implementation
 * uses session.cookies + net.request so Amazon's anti-bot sees a normal
 * Chromium HTTP client rather than a Playwright headless browser. The
 * connector calls this from validateViaNet(); fetchSince and reconnect
 * remain on Playwright because they need actual DOM interaction.
 */
export interface CloudNetValidator {
  validate(): Promise<CloudConnectorStatus>;
}

export type PlaywrightCloudOptions = {
  notebookUrl: string;
  storageStatePath: string;
  profilePath?: string;
  chromiumMode?: ChromiumMode;
  netValidator?: CloudNetValidator;
  onNeedsAuth?: () => Promise<void>;
  onFetchProgress?: (event: CloudFetchStats) => void;
  onBookFetched?: (event: CloudBookDiscovery) => void;
  onDebug?: (message: string) => void;
  onValidation?: (report: CloudValidationReport) => void;
};

type LaunchSpec = {
  headless: boolean;
  args: string[];
};

function runChromiumOptions(mode: ChromiumMode): LaunchSpec {
  switch (mode) {
    case "headed_visible":
      return { headless: false, args: [] };
    case "offscreen_headed":
      return { headless: false, args: ["--window-position=-2400,-2400", "--window-size=1280,900"] };
    case "new_headless":
      return { headless: true, args: ["--headless=new"] };
    case "legacy_headless":
    default:
      return { headless: true, args: [] };
  }
}

export class PlaywrightCloudNotebookConnector implements CloudNotebookConnector {
  private status: CloudConnectorStatus = "needs_auth";
  private statusValidatedAtMs: number | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private currentlyHeadless: boolean = true;

  constructor(private readonly options: PlaywrightCloudOptions) {
    // Optimistic initial state: if a prior session left auth artifacts on
    // disk, presume we're connected until a real sync operation proves
    // otherwise. Routine status reads no longer launch Playwright, so we
    // need to start out trusting persisted state instead of pessimistically
    // reporting needs_auth and forcing a live validation.
    if (this.hasPersistedAuthArtifacts()) {
      this.status = "connected";
      this.statusValidatedAtMs = Date.now();
    }
    if (options.onValidation) {
      const artifactStats = dumpAuthArtifactsState({
        storageStatePath: options.storageStatePath,
        profilePath: options.profilePath
      });
      options.onValidation({
        timestamp: new Date().toISOString(),
        phase: "startup",
        headless: false,
        finalUrl: "",
        urlClassification: "unknown",
        loginFormVisible: false,
        notebookDomPresent: false,
        cookieJarSize: 0,
        hasAtMainCookie: false,
        hasUbidMainCookie: false,
        ...artifactStats,
        outcome: "transient",
        decisionReasonCode: "ok"
      });
    }
  }

  async getStatus(): Promise<CloudConnectorStatus> {
    // Sync-driven status. We never launch a browser here — fetchSince()
    // and reconnect() are the only paths that authoritatively update
    // this.status. Routine status reads just reflect what we already
    // know: cookies on disk → presume the prior session is intact;
    // no cookies → needs_auth. The proof is whether the next sync
    // works, not a speculative headless probe.
    return this.withConnectorLock(async () => {
      if (!this.hasPersistedAuthArtifacts()) {
        this.status = "needs_auth";
        this.statusValidatedAtMs = Date.now();
      }
      return this.status;
    });
  }

  getCachedStatus(): CloudCachedStatus {
    return { status: this.status, validatedAtMs: this.statusValidatedAtMs };
  }

  /**
   * Cheap, no-browser status check. Delegates to the injected netValidator
   * (typically Electron's session.cookies + net.request) and updates the
   * cached status. Returns null and leaves status untouched if no validator
   * was provided or if no auth artifacts are on disk to validate against.
   */
  async validateViaNet(): Promise<CloudConnectorStatus | null> {
    if (!this.options.netValidator) {
      return null;
    }
    return this.withConnectorLock(async () => {
      if (!this.hasPersistedAuthArtifacts()) {
        this.status = "needs_auth";
        this.statusValidatedAtMs = Date.now();
        return this.status;
      }
      try {
        const result = await this.options.netValidator!.validate();
        this.status = result;
        this.statusValidatedAtMs = Date.now();
        return this.status;
      } catch {
        // Validation failed unexpectedly (network error, parsing error).
        // Don't flip status — leave it as-is and let the next sync or
        // validation attempt decide.
        return this.status;
      }
    });
  }

  async reconnect(): Promise<void> {
    return this.withConnectorLock(async () => {
      if (this.options.onNeedsAuth) {
        await this.options.onNeedsAuth();
      }
      const { browser, context } = await this.openContext({ interactive: true });
      try {
        const page = await context.newPage();
        if (await this.canAccessNotebook(page, "reconnect")) {
          this.status = "reconnected";
          this.statusValidatedAtMs = Date.now();
          await this.persistContextState(context);
          return;
        }

        // Let the user complete login interactively in the opened browser window.
        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline) {
          await page.waitForTimeout(1000);
          // During interactive auth, do not force navigation continuously. Once a session
          // appears authenticated, verify notebook access explicitly in case the final URL
          // does not land exactly on notebook path after login redirects.
          if (await this.isAuthenticatedPage(page)) {
            const canAccessNotebook = await this.canAccessNotebook(page, "reconnect").catch(() => false);
            if (canAccessNotebook || this.isNotebookUrl(page.url())) {
              this.status = "reconnected";
              this.statusValidatedAtMs = Date.now();
              await this.persistContextState(context);
              return;
            }
          }
        }

        this.status = "needs_auth";
        this.statusValidatedAtMs = Date.now();
        throw new Error("Cloud notebook sign-in was not completed before timeout.");
      } finally {
        await context.close();
        if (browser) {
          await browser.close();
        }
      }
    });
  }

  async fetchSince(cursor?: string, options?: CloudFetchOptions): Promise<CloudFetchResult> {
    const signal = options?.signal;
    const throwIfAborted = (): void => {
      signal?.throwIfAborted();
    };
    throwIfAborted();
    return this.withConnectorLock(async () => {
      throwIfAborted();
      const { browser, context } = await this.openContext();
      try {
        const page = await context.newPage();
        if (!(await this.canAccessNotebook(page, "fetch"))) {
          this.status = "needs_auth";
          this.statusValidatedAtMs = Date.now();
          throw new Error("Cloud notebook session expired.");
        }

        this.status = this.status === "reconnected" ? "reconnected" : "connected";
        this.statusValidatedAtMs = Date.now();
        await this.persistContextState(context);
        throwIfAborted();
        const books = await this.collectLibraryBooks(page);
        const totalBooks = Math.max(1, books.length);
        let scannedBooks = 0;
        let skippedBooks = 0;
        let rowsSeen = 0;
        let rowsAccepted = 0;
        let fingerprintSkippedBooks = 0;
        let fingerprintChangedBooks = 0;
        const passagesById = new Map<string, CloudPassage>();
        const fingerprints = new Map<string, CloudBookFingerprint>();
        const fetchedBookIds: string[] = [];
        const skippedByFingerprintBookIds: string[] = [];
        const sidebarBookIds: string[] = [];
        const reportFetchProgress = (): void => {
          this.options.onFetchProgress?.({
            scannedBooks,
            totalBooks,
            skippedBooks,
            rowsSeen,
            rowsAccepted,
            passagesDiscovered: passagesById.size,
            fingerprintSkippedBooks,
            fingerprintChangedBooks
          });
        };
        const rememberPassages = (items: CloudPassage[]): void => {
          for (const passage of items) {
            if (!passage.positionStart || !passage.positionKind || passage.positionKind === "unknown") {
              const decoded = decodeKindleHighlightLocation(passage.externalPassageId);
              if (decoded) {
                passage.positionStart = decoded.positionStart;
                passage.positionKind = decoded.positionKind;
              }
            }
            const key = [
              passage.externalBookId ?? passage.storeIdentifier ?? "",
              passage.externalPassageId ?? `${passage.body.slice(0, 120)}:${passage.positionStart ?? ""}`
            ].join("::");
            passagesById.set(key, passage);
          }
        };

        if (books.length === 0) {
          const extracted = await this.extractCurrentBookPassages(page);
          rowsSeen += extracted.rowsSeen;
          rowsAccepted += extracted.rowsAccepted;
          rememberPassages(extracted.passages);
          scannedBooks = 1;
          if (extracted.passages.length > 0) {
            this.options.onBookFetched?.({ book: undefined, passages: extracted.passages });
          }
          reportFetchProgress();
        } else {
          reportFetchProgress();
          for (const [bookIndex, book] of books.entries()) {
            throwIfAborted();
            sidebarBookIds.push(book.id);
            const selectStartedAt = Date.now();
            const selected = await this.selectBook(page, book.id);
            const selectDurationMs = Date.now() - selectStartedAt;
            scannedBooks = bookIndex + 1;
            if (!selected) {
              skippedBooks += 1;
              this.options.onDebug?.(
                `book id=${book.id} select_ms=${selectDurationMs} peek_ms=0 extract_ms=0 decision=select-failed`
              );
              reportFetchProgress();
              continue;
            }
            throwIfAborted();
            const peekStartedAt = Date.now();
            let peekedFingerprint: string | undefined;
            try {
              peekedFingerprint = await this.peekBookFingerprint(page);
            } catch (peekError) {
              this.options.onDebug?.(
                `book id=${book.id} peek_error=${String(peekError)} -- falling through to extract`
              );
            }
            const peekDurationMs = Date.now() - peekStartedAt;

            if (peekedFingerprint !== undefined) {
              fingerprints.set(book.id, peekedFingerprint);
              const decision = decideBookAction({
                prior: options?.knownFingerprints?.get(book.id),
                peeked: peekedFingerprint,
                forceFullSweep: options?.forceFullSweep ?? false
              });
              if (decision.kind === "skip") {
                fingerprintSkippedBooks += 1;
                skippedByFingerprintBookIds.push(book.id);
                this.options.onDebug?.(
                  `book id=${book.id} select_ms=${selectDurationMs} peek_ms=${peekDurationMs} extract_ms=0 decision=unchanged`
                );
                reportFetchProgress();
                continue;
              }
              this.options.onDebug?.(
                `book id=${book.id} select_ms=${selectDurationMs} peek_ms=${peekDurationMs} decision=changed reason=${decision.reason}`
              );
            }

            const extractStartedAt = Date.now();
            let extracted;
            try {
              extracted = await this.extractCurrentBookPassages(page, book);
            } catch (extractError) {
              fingerprints.delete(book.id);
              skippedBooks += 1;
              this.options.onDebug?.(
                `book id=${book.id} extract_error=${String(extractError)} -- fingerprint not stored`
              );
              reportFetchProgress();
              continue;
            }
            const extractDurationMs = Date.now() - extractStartedAt;
            rowsSeen += extracted.rowsSeen;
            rowsAccepted += extracted.rowsAccepted;
            rememberPassages(extracted.passages);
            fetchedBookIds.push(book.id);
            fingerprintChangedBooks += 1;
            if (extracted.passages.length > 0) {
              this.options.onBookFetched?.({
                book: {
                  id: book.id,
                  storeIdentifier: book.storeIdentifier,
                  title: book.title,
                  creator: book.creator,
                  coverImageUrl: book.coverImageUrl
                },
                passages: extracted.passages
              });
            }
            this.options.onDebug?.(
              `book id=${book.id} select_ms=${selectDurationMs} peek_ms=${peekDurationMs} extract_ms=${extractDurationMs} decision=extracted`
            );
            reportFetchProgress();
          }
        }
        const passages = Array.from(passagesById.values());

        return {
          cursor: cursor ?? new Date().toISOString(),
          passages,
          fingerprints,
          fetchedBookIds,
          skippedByFingerprintBookIds,
          sidebarBookIds,
          stats: {
            totalBooks,
            scannedBooks,
            skippedBooks,
            rowsSeen,
            rowsAccepted,
            passagesDiscovered: passages.length,
            fingerprintSkippedBooks,
            fingerprintChangedBooks
          }
        };
      } finally {
        await context.close();
        if (browser) {
          await browser.close();
        }
      }
    });
  }

  private async openContext(options?: { interactive?: boolean }): Promise<{ browser?: Browser; context: BrowserContext }> {
    this.ensurePersistencePaths();

    const mode: ChromiumMode = options?.interactive
      ? "headed_visible"
      : this.options.chromiumMode ?? "legacy_headless";
    const launchSpec = runChromiumOptions(mode);
    this.currentlyHeadless = launchSpec.headless;

    if (this.options.profilePath) {
      const context = await chromium.launchPersistentContext(this.options.profilePath, {
        headless: launchSpec.headless,
        args: launchSpec.args
      });
      await this.mergeStorageStateCookies(context);
      return { context };
    }

    const browser = await chromium.launch({ headless: launchSpec.headless, args: launchSpec.args });
    const context = fs.existsSync(this.options.storageStatePath)
      ? await browser.newContext({ storageState: this.options.storageStatePath })
      : await browser.newContext();
    return { browser, context };
  }

  private async mergeStorageStateCookies(context: BrowserContext): Promise<void> {
    if (!fs.existsSync(this.options.storageStatePath)) {
      return;
    }
    const incoming = parseStorageStateCookies(this.options.storageStatePath);
    if (incoming.length === 0) {
      return;
    }
    const existing = await context.cookies();
    const newCookies = filterNewCookies(incoming, existing);
    if (newCookies.length === 0) {
      return;
    }
    try {
      await context.addCookies(newCookies);
      this.options.onDebug?.(`merged ${newCookies.length} cookies from storage-state into persistent profile`);
    } catch (error) {
      this.options.onDebug?.(`cookie merge failed: ${(error as Error).message}`);
    }
  }

  private async isAuthenticatedPage(page: Page): Promise<boolean> {
    const currentUrl = page.url();
    if (/signin|login|auth|ap\/signin|ap\/mfa|challenge|captcha|verify/i.test(currentUrl)) {
      return false;
    }

    // URL alone can be misleading during redirects; check for common login fields too.
    const loginFormSelectors = ["#ap_email", "#ap_password", "input[type='password']", "input[name='email']"];
    for (const selector of loginFormSelectors) {
      const appearsVisible = await page
        .locator(selector)
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (appearsVisible) {
        return false;
      }
    }
    return true;
  }

  private async validateNotebookAccess(page: Page, phase: ValidationPhase): Promise<CloudValidationReport> {
    const headless = this.currentlyHeadless;
    const artifactStats = dumpAuthArtifactsState({
      storageStatePath: this.options.storageStatePath,
      profilePath: this.options.profilePath
    });

    const pageLike = {
      url: () => page.url(),
      goto: (url: string, opts?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }) =>
        page.goto(url, opts),
      waitForLoadState: (state: "domcontentloaded" | "load" | "networkidle") =>
        page.waitForLoadState(state).then(() => undefined),
      isLoginFormVisible: async (): Promise<boolean> => {
        for (const selector of ["#ap_email", "#ap_password", "input[type='password']", "input[name='email']"]) {
          const visible = await page.locator(selector).first().isVisible({ timeout: 200 }).catch(() => false);
          if (visible) return true;
        }
        return false;
      },
      isNotebookDomPresent: () =>
        page
          .evaluate(() =>
            Boolean(
              document.querySelector("#kp-notebook-library") ||
                document.querySelector("#kp-notebook-annotations") ||
                document.querySelector(".kp-notebook-library-each-book") ||
                document.querySelector(".kp-notebook-highlight")
            )
          )
          .catch(() => false),
      getCookies: () => page.context().cookies()
    };

    const initialReport = await validate(pageLike, {
      notebookUrl: this.options.notebookUrl,
      phase,
      headless,
      artifactStats
    });

    // Apply the existing continue-shopping interstitial bypass as part of validation —
    // if we can bypass and re-check, do so once before reporting. Emit BOTH the
    // pre-bypass and post-bypass reports so telemetry retains the interstitial signal.
    if (initialReport.urlClassification === "interstitial_continue_shopping") {
      this.options.onValidation?.(initialReport);
      await this.bypassContinueShoppingInterstitial(page).catch(() => undefined);
      const postBypassReport = await validate(pageLike, {
        notebookUrl: this.options.notebookUrl,
        phase,
        headless,
        artifactStats
      });
      this.options.onValidation?.(postBypassReport);
      return postBypassReport;
    }

    this.options.onValidation?.(initialReport);
    return initialReport;
  }

  private async canAccessNotebook(page: Page, phase: ValidationPhase = "fetch"): Promise<boolean> {
    const report = await this.validateNotebookAccess(page, phase);
    return report.outcome === "connected";
  }

  private async collectLibraryBooks(page: Page): Promise<CloudLibraryBook[]> {
    return page.evaluate(async () => {
      const seen = new Map<string, CloudLibraryBook>();
      const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value: string | undefined): string | undefined => {
        const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
        return trimmed.length > 0 ? trimmed : undefined;
      };
      const normalizeUrl = (value: string | undefined): string | undefined => {
        const raw = normalize(value);
        if (!raw) {
          return undefined;
        }
        const unquoted = raw.replace(/^['"]|['"]$/g, "");
        if (unquoted.startsWith("//")) {
          return `https:${unquoted}`;
        }
        if (/^https?:\/\//i.test(unquoted)) {
          return unquoted;
        }
        return undefined;
      };
      const tryExtractAsin = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }
        const match = /([A-Z0-9]{10})/i.exec(value);
        return match?.[1]?.toUpperCase();
      };
      const parseSrcset = (srcset: string | undefined): string | undefined => {
        if (!srcset) {
          return undefined;
        }
        return srcset
          .split(",")
          .map((part) => normalizeUrl(part.trim().split(/\s+/)[0]))
          .find((entry) => Boolean(entry));
      };
      const parseStyleBackgroundUrl = (styleValue: string | undefined): string | undefined => {
        if (!styleValue) {
          return undefined;
        }
        const match = styleValue.match(/url\((['"]?)(.*?)\1\)/i);
        return normalizeUrl(match?.[2]?.trim());
      };
      const parseDynamicImageData = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          for (const key of Object.keys(parsed)) {
            const url = normalizeUrl(key);
            if (url) {
              return url;
            }
          }
        } catch {
          return undefined;
        }
        return undefined;
      };
      const isMetadataTitle = (value: string | undefined): boolean => {
        const normalized = (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
        if (!normalized) {
          return false;
        }
        return (
          normalized.includes("highlight") ||
          normalized.startsWith("page ") ||
          normalized.startsWith("location ") ||
          normalized.startsWith("location:") ||
          normalized.startsWith("loc ") ||
          normalized.startsWith("loc:") ||
          normalized.startsWith("note ")
        );
      };
      const resolveReadableTitle = (candidates: Array<string | undefined>): string | undefined => {
        for (const candidate of candidates) {
          const normalized = (candidate ?? "").trim().replace(/\s+/g, " ");
          if (!normalized) {
            continue;
          }
          if (isMetadataTitle(normalized)) {
            continue;
          }
          if (/^[A-Z0-9]{10}$/i.test(normalized)) {
            continue;
          }
          return normalized;
        }
        return undefined;
      };
      const extractCoverUrlFromBookNode = (node: HTMLElement): string | undefined => {
        const imageNode = node.querySelector("img") as HTMLImageElement | null;
        const dynamicNode = node.querySelector("[data-a-dynamic-image]") as HTMLElement | null;
        const styleNode = node.querySelector("[style*='background-image']") as HTMLElement | null;
        return (
          normalizeUrl(imageNode?.currentSrc) ??
          normalizeUrl(imageNode?.src) ??
          normalizeUrl(imageNode?.getAttribute("data-src") ?? undefined) ??
          normalizeUrl(imageNode?.getAttribute("data-old-hires") ?? undefined) ??
          normalizeUrl(imageNode?.getAttribute("data-image-source") ?? undefined) ??
          parseSrcset(imageNode?.srcset) ??
          parseSrcset(imageNode?.getAttribute("data-srcset") ?? undefined) ??
          normalizeUrl(node.getAttribute("data-cover-url") ?? undefined) ??
          normalizeUrl(node.getAttribute("data-image-url") ?? undefined) ??
          normalizeUrl(node.getAttribute("data-thumb-url") ?? undefined) ??
          parseDynamicImageData(dynamicNode?.getAttribute("data-a-dynamic-image") ?? undefined) ??
          parseStyleBackgroundUrl(styleNode?.getAttribute("style") ?? undefined) ??
          parseStyleBackgroundUrl(node.getAttribute("style") ?? undefined)
        );
      };
      const collect = (): void => {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(
            "#library-section [data-asin], #kp-notebook-library .kp-notebook-library-each-book[id], .kp-notebook-library-each-book[id]"
          )
        );
        for (const node of items) {
          const dataAsin = node.getAttribute("data-asin") ?? undefined;
          const id = normalize(dataAsin) ?? normalize(node.id);
          if (id) {
            const title = resolveReadableTitle([
              normalize((node.querySelector("h2") as HTMLElement | null)?.innerText ?? undefined),
              normalize(node.getAttribute("data-book-title") ?? undefined),
              normalize(node.getAttribute("title") ?? undefined)
            ]);
            const creator = normalize(
              ((node.querySelector("p, .a-color-secondary") as HTMLElement | null)?.innerText ?? "").replace(/^By:\s*/i, "")
            );
            const coverImageUrl = extractCoverUrlFromBookNode(node);
            const storeIdentifier = tryExtractAsin(dataAsin) ?? tryExtractAsin(id);
            const existing = seen.get(id);
            seen.set(id, {
              id,
              storeIdentifier: existing?.storeIdentifier ?? storeIdentifier,
              title: title ?? existing?.title,
              creator: creator ?? existing?.creator,
              coverImageUrl: existing?.coverImageUrl ?? coverImageUrl
            });
          }
        }
      };

      collect();
      const library = (document.querySelector("#library-section") ??
        document.querySelector("#kp-notebook-library")) as HTMLElement | null;
      const scroller = (library?.closest(".a-scroller") as HTMLElement | null) ?? library;
      if (!scroller) {
        return Array.from(seen.values());
      }

      let stagnantIterations = 0;
      let lastCount = seen.size;
      for (let iteration = 0; iteration < 240; iteration += 1) {
        scroller.scrollTop = scroller.scrollTop + Math.max(scroller.clientHeight, 300);
        await sleep(120);
        collect();
        if (seen.size === lastCount) {
          stagnantIterations += 1;
        } else {
          stagnantIterations = 0;
          lastCount = seen.size;
        }
        if (stagnantIterations >= 8) {
          break;
        }
      }
      return Array.from(seen.values());
    });
  }

  private async selectBook(page: Page, bookId: string): Promise<boolean> {
    const asinMatch = /([A-Z0-9]{10})/i.exec(bookId);
    if (asinMatch?.[1]) {
      try {
        const directBookUrl = new URL(this.options.notebookUrl);
        directBookUrl.searchParams.set("asin", asinMatch[1].toUpperCase());
        await page.goto(directBookUrl.toString(), { waitUntil: "domcontentloaded" });
        await this.bypassContinueShoppingInterstitial(page);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        if (await this.isNotebookExperience(page)) {
          return true;
        }
      } catch {
        // Fall back to sidebar click selection below.
      }
    }
    const locator = page
      .locator(`.kp-notebook-library-each-book[id="${bookId}"], #library-section [data-asin="${bookId}"], [data-asin="${bookId}"]`)
      .first();
    const exists = await locator.count().then((count) => count > 0).catch(() => false);
    if (!exists) {
      return false;
    }
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    const clicked = await locator
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(async () => locator.click({ timeout: 5000, force: true }).then(() => true).catch(() => false));
    if (!clicked) {
      return false;
    }
    await page
      .waitForFunction(
        (targetBookId) => {
          const selected = document.querySelector(
            "#library-section [aria-selected='true'], .kp-notebook-library-each-book.kp-notebook-library-each-book-selected, .kp-notebook-library-each-book.a-color-base-background"
          ) as HTMLElement | null;
          const selectedId = selected?.id?.trim() || selected?.getAttribute("data-asin")?.trim();
          return selectedId === targetBookId;
        },
        bookId,
        { timeout: 5_000 }
      )
      .catch(() => undefined);
    await page.waitForTimeout(250);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    return true;
  }

  private async bypassContinueShoppingInterstitial(page: Page): Promise<void> {
    const continueTargets = [
      page.getByRole("button", { name: /continue shopping/i }).first(),
      page.getByRole("link", { name: /continue shopping/i }).first(),
      page.locator("button, a").filter({ hasText: /continue shopping/i }).first()
    ];
    for (const target of continueTargets) {
      const visible = await target.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) {
        continue;
      }
      const clicked = await target
        .click({ timeout: 3_000 })
        .then(() => true)
        .catch(async () => target.click({ timeout: 3_000, force: true }).then(() => true).catch(() => false));
      if (!clicked) {
        continue;
      }
      this.options.onDebug?.("continue_shopping_interstitial_bypassed");
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      break;
    }
  }

  private async isNotebookExperience(page: Page): Promise<boolean> {
    const urlLooksLikeNotebook = this.isNotebookUrl(page.url());
    const hasNotebookDom = await page
      .evaluate(() =>
        Boolean(
          document.querySelector("#kp-notebook-library") ||
            document.querySelector("#kp-notebook-annotations") ||
            document.querySelector(".kp-notebook-library-each-book") ||
            document.querySelector(".kp-notebook-highlight")
        )
      )
      .catch(() => false);
    return urlLooksLikeNotebook && hasNotebookDom;
  }

  private async extractCurrentBookPassages(
    page: Page,
    selectedBook?: CloudLibraryBook
  ): Promise<{ passages: CloudPassage[]; rowsSeen: number; rowsAccepted: number }> {
    const extraction = await page.evaluate((params: CloudLibraryBook) => {
      const targetBookId = params.id;
      const targetBookTitle = params.title;
      const targetBookCreator = params.creator;
      const targetBookCoverImageUrl = params.coverImageUrl;
      const targetStoreIdentifier = params.storeIdentifier;
      const tryExtractAsin = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }
        const match = /([A-Z0-9]{10})/i.exec(value);
        return match?.[1]?.toUpperCase();
      };
      const firstHttpUrl = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }
        const match = value.match(/https?:\/\/[^\s"'()]+/i);
        return match?.[0];
      };
      const parseStyleBackgroundUrl = (styleValue: string | undefined): string | undefined => {
        if (!styleValue) {
          return undefined;
        }
        const match = styleValue.match(/url\((['"]?)(.*?)\1\)/i);
        const candidate = match?.[2]?.trim();
        if (!candidate) {
          return undefined;
        }
        if (candidate.startsWith("//")) {
          return `https:${candidate}`;
        }
        return candidate;
      };
      const parseSrcset = (srcset: string | undefined): string | undefined => {
        if (!srcset) {
          return undefined;
        }
        const first = srcset
          .split(",")
          .map((part) => part.trim().split(/\s+/)[0])
          .find((part) => typeof part === "string" && part.length > 0);
        return first;
      };
      const extractCoverUrl = (bookNode: HTMLElement | null, fallbackMarkup: string): string | undefined => {
        const candidates: Array<string | undefined> = [];
        const imageLikeNode = bookNode?.querySelector(
          "img, [data-cover-url], [data-image-url], [data-thumb-url], [style*='background-image']"
        ) as HTMLElement | HTMLImageElement | null;
        if (imageLikeNode instanceof HTMLImageElement) {
          candidates.push(imageLikeNode.currentSrc);
          candidates.push(imageLikeNode.src);
          candidates.push(imageLikeNode.getAttribute("data-src") ?? undefined);
          candidates.push(imageLikeNode.getAttribute("data-old-hires") ?? undefined);
          candidates.push(imageLikeNode.getAttribute("data-image-source") ?? undefined);
          candidates.push(parseSrcset(imageLikeNode.srcset));
          candidates.push(parseSrcset(imageLikeNode.getAttribute("data-srcset") ?? undefined));
          candidates.push(parseDynamicImageData(imageLikeNode.getAttribute("data-a-dynamic-image") ?? undefined));
        }
        if (imageLikeNode) {
          candidates.push(imageLikeNode.getAttribute("data-cover-url") ?? undefined);
          candidates.push(imageLikeNode.getAttribute("data-image-url") ?? undefined);
          candidates.push(imageLikeNode.getAttribute("data-thumb-url") ?? undefined);
          candidates.push(parseDynamicImageData(imageLikeNode.getAttribute("data-a-dynamic-image") ?? undefined));
          candidates.push(parseStyleBackgroundUrl(imageLikeNode.getAttribute("style") ?? undefined));
        }
        const dynamicNode = bookNode?.querySelector("[data-a-dynamic-image]") as HTMLElement | null;
        candidates.push(parseDynamicImageData(dynamicNode?.getAttribute("data-a-dynamic-image") ?? undefined));
        candidates.push(parseStyleBackgroundUrl(bookNode?.getAttribute("style") ?? undefined));
        const markupUrl = firstHttpUrl(fallbackMarkup);
        if (markupUrl) {
          candidates.push(markupUrl);
        }
        return candidates.find((entry) => {
          if (!entry) {
            return false;
          }
          if (entry.startsWith("//")) {
            return true;
          }
          return /^https?:\/\//i.test(entry);
        });
      };
      const parseDynamicImageData = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          for (const key of Object.keys(parsed)) {
            const normalized = key.trim();
            if (normalized.startsWith("//")) {
              return `https:${normalized}`;
            }
            if (/^https?:\/\//i.test(normalized)) {
              return normalized;
            }
          }
        } catch {
          return undefined;
        }
        return undefined;
      };
      const resolveExternalPassageId = (
        row: HTMLElement | null,
        highlightNode: HTMLElement,
        bookId: string,
        rowIndex: number
      ): string => {
        const rowId = row?.id;
        const elementId = highlightNode.id;
        const prefixedId = [rowId, elementId].find(
          (candidate) => candidate?.startsWith("highlight-") || candidate?.startsWith("annotation-")
        );
        return (
          row?.dataset.annotationId ??
          row?.dataset.highlightId ??
          highlightNode.dataset.highlightId ??
          prefixedId?.replace(/^highlight-/, "") ??
          prefixedId?.replace(/^annotation-/, "") ??
          `${bookId}:row:${rowIndex}`
        );
      };
      const parsePosition = (
        text: string | undefined
      ): { positionStart?: string; positionEnd?: string; positionKind?: "page" | "location" | "unknown" } => {
        if (!text) {
          return { positionKind: "unknown" };
        }
        const normalized = text
          .replaceAll("\u2013", "-")
          .replaceAll("\u2014", "-")
          .replaceAll("\u2212", "-")
          .replace(/[,\u202f]/g, "");
        const parseMatch = (match: RegExpMatchArray | null): { positionStart?: string; positionEnd?: string } | null => {
          if (!match?.[1]) {
            return null;
          }
          return {
            positionStart: match[1],
            positionEnd: match[2]
          };
        };
        const locationMatch =
          parseMatch(normalized.match(/\bLoc(?:ation)?\.?\s*:?\s*(\d+)(?:\s*-\s*(\d+))?/i)) ??
          parseMatch(normalized.match(/\b(?:Your\s+)?Highlight(?:\s+\([^)]+\))?\s*-\s*Loc(?:ation)?\.?\s*(\d+)(?:\s*-\s*(\d+))?/i));
        if (locationMatch) {
          return {
            ...locationMatch,
            positionKind: "location"
          };
        }
        const pageMatch = parseMatch(normalized.match(/\bPage\.?\s*:?\s*(\d+)(?:\s*-\s*(\d+))?/i));
        if (pageMatch) {
          return {
            ...pageMatch,
            positionKind: "page"
          };
        }
        return { positionKind: "unknown" };
      };
      const normalizeCandidate = (value: string | undefined): string =>
        (value ?? "")
          .trim()
          .replace(/\s+/g, " ");
      const isMetadataTitle = (value: string | undefined): boolean => {
        const normalized = normalizeCandidate(value).toLowerCase();
        if (!normalized) {
          return false;
        }
        return (
          normalized.includes("highlight") ||
          normalized.startsWith("page ") ||
          normalized.startsWith("location ") ||
          normalized.startsWith("location:") ||
          normalized.startsWith("loc ") ||
          normalized.startsWith("loc:") ||
          normalized.startsWith("note ")
        );
      };
      const resolveReadableTitle = (candidates: Array<string | undefined>): string | undefined => {
        for (const candidate of candidates) {
          const normalized = normalizeCandidate(candidate);
          if (!normalized) {
            continue;
          }
          if (isMetadataTitle(normalized)) {
            continue;
          }
          if (/^[A-Z0-9]{10}$/i.test(normalized)) {
            continue;
          }
          return normalized;
        }
        return undefined;
      };
      const selectedBook = (
        (typeof targetBookId === "string" && targetBookId.length > 0
          ? document.getElementById(targetBookId)
          : null) ??
        (document.querySelector(
          "#library-section [aria-selected='true'], .kp-notebook-library-each-book.kp-notebook-library-each-book-selected, .kp-notebook-library-each-book[aria-selected='true']"
        ) as HTMLElement | null) ??
        (document.querySelector(".kp-notebook-library-each-book.a-color-base-background") as HTMLElement | null)
      ) as HTMLElement | null;
      const selectedBookId = selectedBook?.id?.trim() || targetBookId || "unknown-book";
      const selectedBookMarkup = selectedBook?.outerHTML ?? "";
      const selectedTitle =
        resolveReadableTitle([
          targetBookTitle,
          (selectedBook?.querySelector("h2") as HTMLElement | null)?.innerText,
          selectedBook?.getAttribute("data-book-title") ?? undefined,
          selectedBook?.getAttribute("title") ?? undefined,
          (document.querySelector("h1") as HTMLElement | null)?.innerText
        ]) ?? "Untitled Kindle Book";
      const selectedCreator = (selectedBook?.querySelector("p")?.textContent ?? "")
        .replace(/^By:\s*/i, "")
        .trim();
      const selectedHeader = (document.querySelector(
        "#annotations-section, #kp-notebook-annotations, #annotation-scroller"
      ) ?? document.body) as HTMLElement;
      const selectedHeaderImage = selectedHeader.querySelector("img, [data-a-dynamic-image], [style*='background-image']") as
        | HTMLElement
        | HTMLImageElement
        | null;
      const selectedHeaderCoverImageUrl =
        (selectedHeaderImage instanceof HTMLImageElement
          ? selectedHeaderImage.currentSrc || selectedHeaderImage.src || selectedHeaderImage.getAttribute("data-src")
          : selectedHeaderImage?.getAttribute("data-image-url") ??
            selectedHeaderImage?.getAttribute("data-cover-url") ??
            selectedHeaderImage?.getAttribute("data-thumb-url")) ?? undefined;
      const selectedCoverImageUrl =
        targetBookCoverImageUrl ??
        extractCoverUrl(selectedBook, selectedBookMarkup) ??
        parseDynamicImageData(selectedHeaderImage?.getAttribute("data-a-dynamic-image") ?? undefined) ??
        parseStyleBackgroundUrl(selectedHeaderImage?.getAttribute("style") ?? undefined) ??
        selectedHeaderCoverImageUrl;
      const selectedStoreIdentifier =
        targetStoreIdentifier ?? tryExtractAsin(selectedBook?.getAttribute("data-asin") ?? undefined) ?? tryExtractAsin(selectedBookId);
      const normalizedCreator = selectedCreator.length > 0 ? selectedCreator : targetBookCreator;
      const annotationsRoot = (document.querySelector("#annotations-section") ??
        document.querySelector("#kp-notebook-annotations") ??
        document.body) as HTMLElement;
      const isVisible = (node: HTMLElement | null): boolean => {
        if (!node) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        return node.getClientRects().length > 0;
      };
      const rows = Array.from(
        annotationsRoot.querySelectorAll<HTMLElement>(
          ".kp-notebook-row-separator, [data-annotation-id], [id^='annotation-row-'], [id^='highlight-']"
        )
      ).filter((node, index, allRows) => allRows.indexOf(node) === index && isVisible(node));
      const passages = rows
        .map((row, index) => {
          const highlightNode = (row.querySelector(
            ".kp-notebook-highlight, [id^='highlight'], [class*='highlight-text']"
          ) ?? row) as HTMLElement;
          const body = highlightNode.innerText.trim();
          if (!body || isMetadataTitle(body)) {
            return null;
          }
          const id = resolveExternalPassageId(row, highlightNode, selectedBookId, index);
          const rowLocationNode = row?.querySelector(
            ".kp-notebook-annotation-location, .kp-notebook-metadata, #annotationHighlightHeader, [id*='annotationHighlightHeader'], [class*='annotation-location'], [data-location], [data-annotation-location]"
          ) as HTMLElement | null;
          const metaText = [
            row?.innerText,
            rowLocationNode?.innerText,
            row?.getAttribute("data-location"),
            row?.getAttribute("data-annotation-location"),
            highlightNode.getAttribute("aria-label"),
            highlightNode.getAttribute("data-location"),
            highlightNode.getAttribute("data-annotation-location"),
            highlightNode.dataset.annotation,
            highlightNode.dataset.location
          ]
            .filter((value): value is string => Boolean(value))
            .join(" ");
          const position = parsePosition(metaText);
          const noteNode = row?.querySelector(".kp-notebook-note, .kp-notebook-annotation-note") as HTMLElement | null;
          const rawNote = noteNode?.innerText.trim();
          const note = rawNote && !/^note:\s*$/i.test(rawNote) ? rawNote.replace(/^note:\s*/i, "") : undefined;
          return {
            externalPassageId: id,
            externalBookId: selectedBookId && selectedBookId !== "unknown-book" ? selectedBookId : undefined,
            storeIdentifier: selectedStoreIdentifier,
            coverImageUrl: selectedCoverImageUrl,
            title: selectedTitle,
            creator: normalizedCreator,
            body,
            note,
            positionStart: position.positionStart,
            positionEnd: position.positionEnd,
            positionKind: position.positionKind,
            markedAt: row.dataset.markedAt ?? highlightNode.dataset.markedAt
          };
        })
        .filter((item) => item !== null);
      return {
        rowsSeen: rows.length,
        rowsAccepted: passages.length,
        passages
      };
    }, selectedBook ?? { id: "" });
    return extraction as { passages: CloudPassage[]; rowsSeen: number; rowsAccepted: number };
  }

  private async peekBookFingerprint(page: Page): Promise<string> {
    const data = await page.evaluate((limit: number) => {
      const isVisible = (node: HTMLElement | null): boolean => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return node.getClientRects().length > 0;
      };
      const annotationsRoot = (document.querySelector("#annotations-section") ??
        document.querySelector("#kp-notebook-annotations") ??
        document.body) as HTMLElement;
      const rows = Array.from(
        annotationsRoot.querySelectorAll<HTMLElement>(
          ".kp-notebook-row-separator, [data-annotation-id], [id^='annotation-row-'], [id^='highlight-']"
        )
      ).filter((node, index, all) => all.indexOf(node) === index && isVisible(node));
      const firstIds: string[] = [];
      for (const [i, row] of rows.entries()) {
        if (firstIds.length >= limit) break;
        const highlightNode = (row.querySelector(
          ".kp-notebook-highlight, [id^='highlight'], [class*='highlight-text']"
        ) ?? row) as HTMLElement;
        const rowId = row.id;
        const elementId = highlightNode.id;
        const prefixedId = [rowId, elementId].find(
          (candidate) => candidate?.startsWith("highlight-") || candidate?.startsWith("annotation-")
        );
        const id =
          row.dataset.annotationId ??
          row.dataset.highlightId ??
          highlightNode.dataset.highlightId ??
          prefixedId?.replace(/^highlight-/, "") ??
          prefixedId?.replace(/^annotation-/, "") ??
          `row:${i}`;
        firstIds.push(id);
      }
      return { visibleAnnotationCount: rows.length, firstAnnotationIds: firstIds };
    }, FINGERPRINT_FIRST_ID_LIMIT);
    return computeBookFingerprint(data);
  }

  private isNotebookUrl(candidateUrl: string): boolean {
    try {
      const expected = new URL(this.options.notebookUrl);
      const actual = new URL(candidateUrl);
      return expected.origin === actual.origin && actual.pathname.startsWith(expected.pathname);
    } catch {
      return false;
    }
  }

  private async refreshStatusFromPersistedSession(): Promise<void> {
    if (!this.hasPersistedAuthArtifacts()) {
      this.status = "needs_auth";
      this.statusValidatedAtMs = Date.now();
      return;
    }

    const recentlyValidated =
      this.statusValidatedAtMs !== null && Date.now() - this.statusValidatedAtMs < 60 * 1000 && this.status !== "needs_auth";
    if (recentlyValidated) {
      return;
    }

    const { browser, context } = await this.openContext();
    try {
      const page = await context.newPage();
      this.status = (await this.canAccessNotebook(page, "status_refresh")) ? "connected" : "needs_auth";
      this.statusValidatedAtMs = Date.now();
    } catch {
      this.status = "needs_auth";
      this.statusValidatedAtMs = Date.now();
    } finally {
      await context.close();
      if (browser) {
        await browser.close();
      }
    }
  }

  private ensurePersistencePaths(): void {
    fs.mkdirSync(path.dirname(this.options.storageStatePath), { recursive: true });
    if (this.options.profilePath) {
      fs.mkdirSync(this.options.profilePath, { recursive: true });
    }
  }

  private hasPersistedAuthArtifacts(): boolean {
    const hasStorageState = fs.existsSync(this.options.storageStatePath);
    if (!this.options.profilePath) {
      return hasStorageState;
    }
    if (!fs.existsSync(this.options.profilePath)) {
      return hasStorageState;
    }
    const profileEntries = fs.readdirSync(this.options.profilePath);
    return hasStorageState || profileEntries.length > 0;
  }

  private async persistContextState(context: BrowserContext): Promise<void> {
    await context.storageState({ path: this.options.storageStatePath }).catch(() => undefined);
  }

  private async withConnectorLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export type {
  CloudValidationReport,
  ValidationPhase,
  ValidationOutcome,
  UrlClassification,
  DecisionReasonCode,
  ArtifactStats
} from "./validation-report.js";
export { classifyUrl, validate, dumpAuthArtifactsState, appendValidationReport } from "./validation-report.js";
