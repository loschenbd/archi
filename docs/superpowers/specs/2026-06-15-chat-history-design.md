# Chat History — Persistent Conversations

**Status:** Spec — pending user review before plan
**Date:** 2026-06-15
**Author:** Ben Loschen (with Claude)
**Builds on:** Phase 2 chat (`docs/superpowers/specs/2026-06-15-phase2-chat-design.md`), shipped in PR #6.

## 1. Goal

Replace today's session-only chat with persistent conversations. Every conversation auto-saves to SQLite, appears in a history rail inside the Chat screen, and can be reopened, renamed, or deleted.

## 2. Scope

In:
- Persist conversations + their turns to a new `chat.sqlite` database.
- History rail UI inside the Chat screen (240px, collapsible to 48px).
- Auto-title each conversation from the first user message.
- Rename + delete per conversation.
- Resume a conversation: load history into the transcript; subsequent turns continue persisting against the same conversation id.

Out (deferred to a later branch):
- Full-text search across conversations.
- Folders / tags / starring / pinning.
- Export to markdown / JSON.
- Cross-device sync.
- Editing prior messages.

## 3. Data model

A new SQLite file at `<userData>/chat.sqlite`. Same Better-SQLite3 engine and WAL mode that `archi.sqlite` uses for search, but kept as a separate file so a search-index reset doesn't touch chat.

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,    -- uuid v4
  title       TEXT NOT NULL,       -- first user message, trimmed to 60 chars; user-editable
  model_name  TEXT NOT NULL,       -- snapshot of selected model at creation time
  created_at  INTEGER NOT NULL,    -- unix ms
  updated_at  INTEGER NOT NULL     -- unix ms; bumped on every successful turn
);

CREATE INDEX conversations_updated ON conversations(updated_at DESC);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  citations_json  TEXT,            -- JSON array of passage ids (assistant only); null otherwise
  status          TEXT NOT NULL,   -- 'done' | 'error' | 'aborted' | 'skipped'
  error_code      TEXT,            -- non-null when status='error'
  duration_ms     INTEGER,         -- assistant turn latency
  created_at      INTEGER NOT NULL
);

CREATE INDEX messages_conversation ON messages(conversation_id, created_at);
```

**Why store only `passageIds`, not the passage bodies, on citations?** Search results are the source of truth. We hydrate citation cards by looking up the passage from the existing search index at render time. If a passage gets re-ingested or deleted, the citation card dims with a "passage no longer available" placeholder instead of holding stale text.

## 4. Persistence flow

- A conversation row is created on the **first user submit**, not on `New chat` click. This avoids littering the sidebar with empty rows when a user opens a fresh chat and abandons it.
- Each completed turn writes a `user` message + an `assistant` message in a single SQLite transaction, then bumps `conversations.updated_at`.
- The conversation title is set on first insert from `req.question.trim().slice(0, 60)` plus `…` if truncated.
- Streaming tokens are **not** persisted live — we persist the final assistant message once the turn enters a terminal state (`done`, `aborted`, `error`, `skipped`). If the app crashes mid-stream the partial assistant message is lost. Acceptable trade-off; users can rerun the turn.
- An aborted turn still persists the partial content the user saw (so resume reflects what was on screen).
- A skipped turn persists the user message + a synthetic assistant message with status `skipped` (so resume shows the "no passages matched" hint).

## 5. Resume flow

When the user clicks a past conversation in the rail:
1. Renderer calls `archi:chat:loadConversation(id)`.
2. Main returns `{ conversation, messages }`.
3. Renderer rebuilds `transcript` from `messages` — each row maps directly to a `RenderedMessage`. Citation cards are hydrated via the existing search index by looking up each `passageId` returned in the assistant message's `citations_json`.
4. Selected `modelName` becomes the conversation's stored `model_name` (overrideable via the model picker).
5. Subsequent turns continue persisting against the same conversation id.

When the user clicks `+ New chat`:
- `useChatTurn.reset()` clears in-memory state.
- The renderer drops its `conversationId` ref.
- No DB write happens until the user submits the first message.

## 6. IPC additions

Extends the existing `archi:chat:*` namespace.

| Channel | Args | Return | Notes |
|---|---|---|---|
| `archi:chat:listConversations` | — | `ChatConversation[]` | Sorted by `updated_at DESC` |
| `archi:chat:loadConversation` | `id: string` | `{ conversation: ChatConversation; messages: ChatStoredMessage[] }` | Throws if not found |
| `archi:chat:renameConversation` | `id: string`, `title: string` | `void` | Trims + truncates to 60 chars server-side |
| `archi:chat:deleteConversation` | `id: string` | `void` | CASCADE deletes messages |

Existing `archi:chat:turn` is amended:
- Request gains optional `conversationId?: string`. If absent, the service creates a new row before persisting the turn and surfaces the new id in the `done` event.
- The `done` and `error` events gain `conversationId: string` so the renderer can adopt it for follow-up turns.

A new broadcast event `archi:chat:historyChanged` fires whenever the conversation list mutates (insert, rename, delete, updated_at bump). The renderer's `useChatHistory` hook subscribes and refreshes.

## 7. Code organization

New files:

- `packages/chat/src/persistence/chatStore.ts` — `ChatStore` class wrapping Better-SQLite3. Methods: `createConversation`, `appendTurn`, `listConversations`, `loadConversation`, `renameConversation`, `deleteConversation`. Pure SQL; no Electron imports.
- `packages/chat/src/persistence/migrations/001_init.sql` — schema from §3.
- `packages/chat/src/persistence/migrate.ts` — minimal one-step migrator (no rollback, no version table yet — a `PRAGMA user_version` check is enough until we need a second migration).
- `apps/desktop/src/renderer/components/chat/ChatHistoryRail.tsx` — left rail with grouped list + collapse toggle.
- `apps/desktop/src/renderer/components/chat/ChatHistoryItem.tsx` — single row + kebab menu (Rename / Delete).
- `apps/desktop/src/renderer/hooks/useChatHistory.ts` — load / subscribe / refresh.

Modified files:

- `packages/chat/src/chatService.ts` — accepts a `ChatStore` in its constructor; on terminal turn state, persists user + assistant messages in a transaction.
- `packages/chat/src/types.ts` — adds `ChatConversation`, `ChatStoredMessage`. Extends `ChatTurnRequest` with `conversationId?`. Extends `ChatTurnDoneEvent` + `ChatTurnErrorEvent` with `conversationId`.
- `apps/desktop/src/main/chatModule.ts` — instantiates `ChatStore` at `<userData>/chat.sqlite` and injects it.
- `apps/desktop/src/main/ipc/chatIpc.ts` — registers the four new handlers + emits `historyChanged` broadcasts.
- `apps/desktop/src/preload/index.ts` — exposes the four new methods + `onHistoryChanged(handler)` subscription.
- `apps/desktop/src/renderer/env.d.ts` — types for the new preload methods.
- `apps/desktop/src/renderer/screens/ChatScreen.tsx` — adopts a `conversationId` ref, mounts `ChatHistoryRail`, wires resume + new-chat handlers, splits the layout into rail + transcript.
- `apps/desktop/src/renderer/screens/ChatSetupScreen.tsx` — unaffected.

## 8. UI

Chat screen becomes a two-pane layout:

```
┌──────────────┬──────────────────────────────────────────┐
│ History rail │  Chat composer + transcript              │
│ 240px        │  (the existing Chat UI)                  │
│              │                                          │
│ [+ New chat] │                                          │
│              │                                          │
│ Today        │                                          │
│   • What is …│                                          │
│   • Quotes on…                                          │
│ Yesterday    │                                          │
│   • Question…│                                          │
│ Earlier      │                                          │
│   • Question…│                                          │
└──────────────┴──────────────────────────────────────────┘
```

Layout rules:
- Rail is `display: flex; flex-direction: column` with the `+ New chat` button pinned to the top, a scrollable list in the middle, and an optional collapse chevron at the bottom.
- Active row: `--accent-soft` background + bolded title + thin warm-brown left edge.
- Hover row: a `…` kebab button reveals on hover; click opens a small Rename / Delete menu anchored to the row.
- Group headers (`Today`, `Yesterday`, `Earlier`) use `.ui-card__eyebrow` styling.
- Empty state: a `.ui-fleuron` + the line "Your conversations will appear here."
- Collapsed: 48px wide, shows only the `+ New chat` icon button + a stack of dot indicators (one per conversation, accent-tinted for active). Click any dot expands.

Component shells use the design-system primitives — `.ui-btn--ghost` for kebab actions, `.ui-input` for the inline rename input, the existing `.ui-modal` shell for the delete-confirm dialog.

### Delete-confirm dialog

Single modal with the question "Delete this conversation? This can't be undone." and `Cancel` / `Delete` buttons. Uses the existing `.ui-modal-backdrop` + `.ui-card.ui-modal-card` shell. `Delete` is `.ui-btn--danger`.

### Inline rename

Click the kebab → Rename → the title row swaps for a `.ui-input` with the current title pre-filled and selected. Enter saves; Esc cancels; blur saves. Sends `archi:chat:renameConversation`.

## 9. State & lifecycle

`useChatHistory` hook in the renderer:
- Loads the conversation list on mount via `archi:chat:listConversations`.
- Subscribes to `onHistoryChanged` for live updates.
- Exposes `{ conversations, refresh, rename, delete }`.

`ChatScreen` holds:
- `conversationIdRef: string | null` — the currently active conversation. Set when:
  - User clicks an item in the rail (assigned from that item's id).
  - The first turn of a new conversation completes (assigned from the `done` event's `conversationId`).
- `transcript` — driven by either the live `useChatTurn` stream (in-flight) or by `loadConversation` (for resume).
- `selectedModelName` — initialized from the active conversation's `model_name` on load, defaults to the preference on a fresh chat.

When the user clicks an item:
1. Cancel any in-flight turn (`turn.cancel()`).
2. Call `loadConversation(id)`.
3. Hydrate `transcript` from the result.
4. Set `conversationIdRef = id`.

When the user clicks `+ New chat`:
1. Cancel any in-flight turn.
2. Clear `transcript`.
3. Clear `conversationIdRef`.
4. Reset model selection to the saved preference.

## 10. Error handling

- DB write failures during turn persistence: log the error in main; surface as an `error` event with code `persistence_failed`. The renderer shows the assistant bubble as the existing error bubble. The user's in-memory transcript is unaffected — the next successful turn will retry persistence and may end up with a partial conversation in the rail.
- DB read failures on `loadConversation`: surface to the renderer; the rail item shows a small "Couldn't load conversation" inline error and stays selectable for retry.
- Schema migration failure on startup: log and disable persistence for the session (chat still works but doesn't save). Surface a small warning banner inside the Chat screen.

## 11. Privacy

- All data stays local under `<userData>/chat.sqlite`.
- No telemetry. No outbound calls.
- The standard app delete-account flow (not in scope here) should also delete `chat.sqlite`. We'll add a hook to `removeUserData` when that flow lands.

## 12. Testing

Unit (vitest, in `packages/chat`):
- `ChatStore.createConversation` returns a row with all fields set.
- `ChatStore.appendTurn` inserts both messages atomically; if any insert fails, none are committed.
- `ChatStore.appendTurn` bumps `updated_at`.
- `ChatStore.listConversations` sorts by `updated_at DESC`.
- `ChatStore.loadConversation` returns messages ordered by `created_at`.
- `ChatStore.deleteConversation` cascades to messages.
- `ChatStore.renameConversation` trims + truncates to 60 chars.
- Migration: fresh DB applies `001_init.sql` and bumps `PRAGMA user_version`. Running migrate twice is a no-op.

Integration (vitest, in `packages/chat`):
- `ChatService.runTurn` with a `ChatStore` mock: creates conversation on first turn (no `conversationId`), reuses on second.
- A failed turn emits an `error` event with `conversationId` if the conversation was created.
- An aborted turn still persists the partial content.

Renderer (manual QA — listed in `docs/qa/chat-history.md`):
- Submit two turns; verify rail shows the conversation with the correct title; relaunch the app; verify it's still there.
- Click `+ New chat`; submit one turn; verify two conversations in the rail, newest at top.
- Rename a conversation; verify the rail updates without a refresh.
- Delete a conversation; verify it's removed; relaunch; still gone.
- Resume a conversation; submit a follow-up turn; verify the rail's `updated_at` order updates.
- Collapse rail; verify dots render correctly; expand; verify state preserved.

## 13. Risks

- **Better-SQLite3 native binary rebuild for Electron** — already handled by the project's `rebuild:native` postinstall. New tables in a new file inherit the same rebuild flow.
- **Concurrent writes** — Electron main is single-process; Better-SQLite3 is synchronous + WAL; no concurrency issue.
- **Citation hydration latency** — `loadConversation` returns the bare passage ids; the renderer hydrates them via the existing search index lookup. If the search service is slow on startup, citation cards may pop in after the message text. Acceptable; the message text reads on its own.
- **Database growth** — a heavy user with 1000 turns averaging 1KB content + 200B metadata is ~1.2MB. No retention policy needed in v1.
- **Resume of a conversation whose model is no longer installed** — we show the model name in the badge; the next turn will fail with `model_missing`. The user can pick a different model via the existing setup flow without losing the conversation.

## 14. Out-of-scope follow-ups

These are good v2 features but not part of this branch:

- FTS5 index on `messages.content` + a search input in the rail.
- Pinning / starring; a "Pinned" group at the top.
- Folders; drag-and-drop reordering.
- Export to markdown / JSON / clipboard.
- Editing a prior user message to fork the conversation.
- Cross-device sync (would require an encrypted blob + a sync surface).

## 15. References

- v1 chat spec: `docs/superpowers/specs/2026-06-15-phase2-chat-design.md` §14 (history listed as deferred).
- Phase 1 search persistence patterns: `packages/search/src/persistence/*` for SQLite setup, migration, and rebuild script.
- Better-SQLite3 Electron rebuild: `apps/desktop/scripts/rebuild-native-for-electron.mjs` (already wired).

---

**Next step after user review:** Generate `docs/superpowers/plans/2026-06-15-chat-history.md` with task-by-task plan, then execute via subagent-driven development.
