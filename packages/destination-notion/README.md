# @archi/destination-notion

Notion destination for Archi. Provisions Library + Passages databases, upserts works and passages, and sets per-page icon and cover image.

## Icon and cover selection

Each Library page in Notion gets an `icon` and (when possible) a `cover`. Selection priority:

| Source                              | Icon                                         | Cover     |
| ----------------------------------- | -------------------------------------------- | --------- |
| `Work.coverImageUrl` present         | external image (same URL as cover)           | same URL  |
| `Work.coverImageUrl` missing         | emoji from the table below                   | (omitted) |

**Emoji fallback by `WorkType`:**

| Work type   | Emoji |
| ----------- | ----- |
| `book`      | 📚    |
| `article`   | 📰    |
| `periodical`| 🗞️    |
| `document`  | 📄    |
| `other`     | 📌    |
| (unknown)   | 📌    |

## Idempotency

On every sync, for each Library page:

- If the page was just created, write icon and cover in a single update (no read).
- Otherwise, read the page's current icon/cover. If they already match the desired values, no update is sent. Otherwise, send a single update with only the fields that differ.
- We **do not** clear an existing cover when a work's URL disappears on a normal sync. (Use the force refresh below if you want to clear.)

The Notion page itself is the source of truth for "have we written this already." We do not persist a separate write-log locally.

## Force refresh

Click **"Refresh Notion media"** on the Connections screen (in the Notion card's action row) to re-write icon and cover for every Library page, regardless of current state. Use this when:

- You changed the cover URL source upstream and want to propagate immediately.
- A previously-customized page should be reset to the Archi default.

The force-refresh action runs a normal sync internally — progress is reported through the same UI as "Sync now."

## URL rejection

If Notion rejects an external image URL (404, hotlink protection, image too large, invalid URL), the page falls back to its emoji icon for the work type and no cover. The sync continues for the remaining works.

## Known limitations

- **Trust-on-first-write.** If you manually change an icon or cover in Notion, the next sync will overwrite it. We may revisit this if a future spec introduces per-page write-provenance tracking.
- **Single URL source.** This package uses whatever `Work.coverImageUrl` the upstream source provides. A separate "media resolver" spec (planned) will add ISBN lookup, OpenGraph image scraping, and favicon resolution to populate URLs for works that lack one.
