/**
 * Highlight quality heuristic for resurfacing.
 *
 * Kindle splits a long highlight across notebook rows and each row is stored
 * as its own passage, so a real library is roughly a quarter continuation
 * fragments — "people's rejection of His Father." or a clause that stops
 * mid-thought. Those are fine in a search result, where surrounding context
 * is one click away, but they read as broken when one is presented on its own
 * as the highlight of the moment.
 *
 * Readwise ships an equivalent filter, on by default, scoped to its Daily
 * Review only. Its documented failure mode is the one worth learning from:
 * readers with Chinese, Japanese or Arabic highlights had valid material
 * hidden because the filter "mistook shorter sentences as fragments". Scripts
 * without letter case cannot satisfy a starts-with-a-capital test, so that
 * test only applies to text that actually has case.
 *
 * This module is deliberately dependency-free so both the main process and
 * the renderer can import it — the renderer cannot pull in `@archi/core`
 * proper, which reaches native SQLite.
 *
 * @see https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights
 */

/** Below this, a passage is a stub regardless of how it reads. */
export const MIN_RESURFACE_LENGTH = 25;

/**
 * Floor for scripts that pack far more meaning per character. "学而时习之，不亦
 * 说乎？有朋自远方来，不亦乐乎？" is a complete two-clause sentence in 22
 * characters — a 25-character floor tuned on English would discard it.
 */
export const MIN_RESURFACE_LENGTH_DENSE = 10;

/** Han, kana, or hangul — the scripts the character floor has to bend for. */
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Opens like a sentence: a capital or digit, optionally behind an open quote. */
const STARTS_CLEANLY = /^["'“‘([]?[A-Z0-9]/;

/** Closes like a sentence, including CJK full stops and Arabic full stop. */
const ENDS_CLEANLY = /["'”’)\]]?[.!?…。！？۔؟]["'”’)\]]?$/;

/** True when the text contains a letter that has an upper/lower distinction. */
const HAS_CASED_LETTERS = /\p{Lu}|\p{Ll}/u;

/**
 * Whether a passage reads as a self-contained sentence.
 *
 * Conservative by design — it gates only what gets *resurfaced*, never what is
 * searchable or exportable, and callers should fall back to the unfiltered
 * pool rather than ever showing nothing.
 */
export function isCompleteSentence(body: string): boolean {
  const text = body.trim();
  const floor = DENSE_SCRIPT.test(text) ? MIN_RESURFACE_LENGTH_DENSE : MIN_RESURFACE_LENGTH;
  if (text.length < floor) {
    return false;
  }
  if (!ENDS_CLEANLY.test(text)) {
    return false;
  }
  // Scripts without letter case (Chinese, Japanese, Arabic, Hebrew…) can never
  // start with a capital, so requiring one would hide all of them.
  if (!HAS_CASED_LETTERS.test(text)) {
    return true;
  }
  return STARTS_CLEANLY.test(text);
}
