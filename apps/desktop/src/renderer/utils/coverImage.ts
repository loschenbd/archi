// Amazon's media CDN encodes a resize directive in the image path — e.g.
// `https://m.media-amazon.com/images/I/<id>._SY160.jpg`, where `_SY<n>` scales
// the render to height n (and `_SX<n>` to width n). The cloud-notebook source
// captures covers at the notebook's thumbnail size (`_SY160` → 107×160), which
// the browser then upsamples into the larger tiles (124×168, doubled on Retina)
// and looks blurry. Rewriting the token to a larger height asks the CDN for a
// genuinely higher-res render — no new request type, no auth.
//
// Verified against a real cover: _SY160 → 107×160 (5KB), _SY400 → 266×400
// (20KB), _SY600 → 399×600 (38KB), bare .jpg → 1400×2103 (220KB).

/**
 * Rewrite an Amazon book-cover URL to request a specific render height in px.
 * No-ops for URLs that don't carry an `_SX`/`_SY` size token (non-Amazon hosts,
 * or already-bare URLs), so it's safe to apply unconditionally.
 */
export function coverAtHeight(url: string | undefined, px: number): string | undefined {
  if (!url) return url;
  return url.replace(/\._S[XY]\d+_?\.jpg$/i, `._SY${px}.jpg`);
}

/**
 * Build a `srcset` string for a 1x/2x Retina pair at the given base CSS height.
 * Returns undefined when the URL isn't a resizable Amazon cover, so callers can
 * spread it without emitting a useless attribute.
 */
export function coverSrcSet(url: string | undefined, basePx: number): string | undefined {
  if (!url || !/\._S[XY]\d+_?\.jpg$/i.test(url)) return undefined;
  return `${coverAtHeight(url, basePx)} 1x, ${coverAtHeight(url, basePx * 2)} 2x`;
}
