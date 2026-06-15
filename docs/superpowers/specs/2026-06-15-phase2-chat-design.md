# Phase 2 — Local-Private Chat Over the Indexed Corpus — Design

**Status:** approved design, ready for implementation planning
**Date:** 2026-06-15
**Author:** ben@benjaminloschen.com (with Claude)
**Scope:** Phase 2 of the local RAG feature. Adds a grounded-synthesis chat layer on top of the Phase 1 semantic + keyword search infrastructure that shipped in v0.2.0. BYO Ollama as the local runtime; classic RAG (fixed prefetch); session-only multi-turn; new top-level Chat screen.

**Builds on:** [`2026-06-02-local-rag-semantic-search-design.md`](2026-06-02-local-rag-semantic-search-design.md) (Phase 1).

## 1. Goal

Let users ask natural-language questions about their saved reading passages and get a **grounded, cited, synthesized answer** drawn only from their own library — fully on-device, no cloud APIs, no telemetry, no per-token cost. Phase 1 made the corpus findable; Phase 2 makes it interrogable.

The unit of value:

> User types "what did the Stoics say about death?"
> → Archi retrieves the top-N relevant passages they've highlighted
> → Local LLM synthesizes a 2–4 sentence answer with `[1] [2] [3]` style citations
> → The cited passages render as familiar SearchResultCards under the answer, clickable into the existing passage detail view

That is the entire job-to-be-done for v2.0.

## 2. Out of scope (v2.0)

Recording these explicitly to prevent scope creep — every one is a reasonable Phase 2.1+ candidate:

- **Persisted chat history / multiple conversations.** Session-only state; closing the app drops it. Phase 2.1.
- **Per-passage "Ask about this" drawer.** Trivial to add once `ChatService` exists; not in v2.0.
- **Query expansion / history-aware retrieval.** Each turn re-runs search with only the latest user message. Phase 2.1 if dogfooding shows the limitation hurts.
- **Tool-calling RAG (LLM decides when/what to search).** Requires reliable function-calling from local models; not bankable in 2026 on small Ollama models. Phase 2.2+.
- **Cross-encoder re-ranking before the LLM sees passages.** Inherited Phase 1 deferral.
- **Apple FoundationModels adapter.** The `LLMClient` interface is designed for this; the Swift helper itself is not built in v2.0.
- **Bundled llama.cpp / zero-install runtime.** Same — designed for the slot, not built.
- **Remote Ollama (e.g., user's home server via `OLLAMA_HOST`).** Separate threat model; v2.0 hardcodes localhost.
- **Cloud LLM APIs (OpenAI, Anthropic, OpenRouter, BYOK).** Off the table; conflicts with the privacy promise.
- **Multimodal / image input.** Archi is text-only.
- **Streaming citation attribution ("which passage influenced this token").** Research-level; not v2.0.
- **Export answer + citations as markdown.** Phase 2.1 (easy add).
- **Indexing of `reader_note` for chat context.** Same column problem as Phase 1; deferred until search itself adds it.
- **GPU/Metal acceleration.** Ollama handles its own runtime; we are an HTTP client.

## 3. Architecture overview

One new package (`packages/chat`), one new IPC namespace, one new top-level screen + one setup screen. No new SQLite objects. Ollama runs out-of-process; we just speak HTTP to it.

```
┌────────────────────────── Electron Renderer (React) ──────────────────────────┐
│                                                                                │
│  ┌──────────────────────────┐    ┌────────────────────────────────────────┐   │
│  │ ChatScreen               │    │ ChatSetupScreen (first-run / recovery) │   │
│  │  • prompt input           │    │  • detection state                     │   │
│  │  • streaming response     │    │  • [Download Ollama] / [Recheck]       │   │
│  │  • cited SearchResultCards│    │  • model picker from /api/tags         │   │
│  │  • session history (state)│    │  • [Pull <recommended>] (streamed)     │   │
│  └─────────────┬─────────────┘    └────────────────┬───────────────────────┘   │
│                │ window.archi.chat.*                │                          │
└────────────────┼────────────────────────────────────┼──────────────────────────┘
                 │ IPC                                │
┌────────────────▼────────────────────────────────────▼──────────────────────────┐
│ Electron Main (Node)                                                           │
│                                                                                │
│  NEW: packages/chat                                                            │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │ ChatService                                                            │   │
│  │  runTurn({ question, history, modelName, options })                    │   │
│  │   1. SearchService.query()  ← EXISTING (packages/search)               │   │
│  │   2. buildRagPrompt(question, results, history)                        │   │
│  │   3. LLMClient.chat(messages, opts) → AsyncIterator<{delta}>           │   │
│  │   4. emit "archi:chat:token" / "archi:chat:done" / "archi:chat:error"  │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                       │                                        │
│  ┌────────────────────────────────────▼──────────────────────────────────┐    │
│  │ LLMClient (interface)                                                  │    │
│  │  detect(): Promise<DetectResult>                                       │    │
│  │  listModels(): Promise<ModelInfo[]>                                    │    │
│  │  pullModel(name): AsyncIterator<PullProgress>                          │    │
│  │  chat({ model, messages, signal }): AsyncIterator<ChatDelta>           │    │
│  └────────────────────────────────────▲──────────────────────────────────┘    │
│                                       │                                        │
│  ┌────────────────────────────────────┴──────────────────────────────────┐    │
│  │ OllamaClient (implementation)                                          │    │
│  │  Talks to http://localhost:11434 (HARDCODED). Raw fetch — no SDK.      │    │
│  └───────────────────────────────────────────────────────────────────────┘    │
│                                                                                │
│  EXISTING: packages/search (Phase 1) — unchanged                               │
│  EXISTING: main/preferences.ts — chat.* keys land here                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

Key boundary decisions:

- **All chat orchestration lives in `packages/chat`.** Renderer has zero knowledge of Ollama, prompts, models, or HTTP — it talks IPC.
- **`ChatService` runs on the main process**, same as `SearchService`. No utilityProcess (Ollama is already out-of-process; we're a thin HTTP client).
- **`LLMClient` is the adapter seam.** Phase 2.x can drop in a `FoundationModelsClient` or `LlamaCppClient` without touching `ChatService`, `ChatScreen`, the prompt, or the IPC contract.
- **No new SQLite objects.** Session-only state lives in React. Persistence is a Phase 2.1 schema-add when needed.
- **Streaming is event-based**, not invoke-based. Each turn gets a `turnId`; renderer routes deltas by id.

## 4. Tech choices and rationale

| Layer | Choice | Why |
|---|---|---|
| LLM runtime | BYO **Ollama** (`http://localhost:11434`) | Mature, simple HTTP API, no SDK to vendor. Users who want local AI already use or accept Ollama. Zero DMG bloat. ~1 week to ship vs. ~3-4 weeks for bundled llama.cpp. |
| Runtime abstraction | `LLMClient` interface in `packages/chat` | Forces a clean contract from day one. Phase 2.x adapters slot in without touching consumers. The interface itself is small (4 methods); the cost is negligible and the optionality is high. |
| Recommended model | `llama3.1:8b` (primary), `phi3:mini` (fallback for older Macs) | Pinned in `packages/chat/src/recommendations.ts`. Picked for: 8k context (room for 8 passages + history + answer), runs on M1 8GB, English-strong, follows citation instructions reliably. Revisit before ship — model landscape moves fast. |
| Retrieval coupling | **Classic RAG (fixed prefetch).** One `SearchService.query()` per turn, top-K=8, mode=hybrid | Works with any local model regardless of tool-call competence. Predictable single-LLM-call latency. Leverages Phase 1's RRF hybrid ranking — natural-language queries are exactly what it's tuned for. Tool-calling RAG depends on small-model function-calling that's not bankable yet. |
| Top-K | 8 passages, configurable later | Sized for an 8k-context model: 8 × ~200 tok ≈ 1.6k tok of passages + ~1k tok history + ~500 tok system = 3.1k tok input, leaving 5k for the answer. Comfortable headroom. |
| Streaming | Event channel (`webContents.send` token-by-token), not invoke | Standard pattern. `invoke` is request/response; token streams need many-to-one. |
| Cancellation | `AbortController` per active turn, IPC channel `archi:chat:cancel` | User clicks "Stop" mid-stream; we abort the fetch to Ollama. |
| Conversation state | React state, in-memory, cleared on app close or "New chat" | No SQLite schema; no migration; documented behavior. Session-only is the right middle ground between one-shot (feels broken when users follow up) and persisted (real product work). |
| Per-turn retrieval | Re-run search with **only the latest user message** | Simplest; usually fine for the synthesis job. Documented limitation; Phase 2.1 candidate is condense-history-to-search-query via tiny LLM call. |
| Preferences storage | Existing `PreferencesStore` (`~/.config/Archi/prefs.json`) | Keys: `chat.modelName`, `chat.topK`, `chat.systemPromptOverride` (advanced; v2.0 read-only). Matches Phase 1's storage pattern. |
| Privacy hostname | Hardcoded `http://localhost:11434` in `OllamaClient` | Not configurable in v2.0. "Use my remote Ollama" is a separate Phase 2.x feature with its own threat model. |

Choices considered and rejected:

- **Bundled llama.cpp via `node-llama-cpp`.** +2–4 GB DMG for any usable model, packaging headaches similar to ONNX (we just lived through this in Phase 1), we own model updates. Not for v2.0.
- **Apple FoundationModels first.** Zero install + zero DMG bloat, but real macOS 26 adoption in mid-2026 is partial; mandatory Ollama fallback means we'd build both. Defer until the adoption math flips.
- **OpenAI / Anthropic / OpenRouter / BYOK paste-key.** Off the table per the v1 spec's privacy posture.
- **Tool-calling RAG / ReAct pattern.** Small local models in 2026 are still uneven at function-calling. Builds in a brittle dependency.
- **Multi-vector or per-sentence indexing.** Phase 1 indexes at passage granularity; Phase 2 inherits. No need to change retrieval shape for this synthesis job.

## 5. Code organization

```
packages/
├── chat/                                ← NEW
│   ├── package.json                     (@archi/chat)
│   ├── src/
│   │   ├── index.ts                     (exports)
│   │   ├── types.ts                     (DetectResult, ModelInfo, PullProgress, ChatDelta, ChatTurn, ChatMessage, etc.)
│   │   ├── llmClient.ts                 (LLMClient interface)
│   │   ├── ollama/
│   │   │   ├── ollamaClient.ts          (OllamaClient implementation)
│   │   │   └── ollamaTypes.ts           (internal API DTOs)
│   │   ├── prompt/
│   │   │   ├── buildRagPrompt.ts        (system prompt + passage formatting + history)
│   │   │   └── systemPrompt.ts          (the system prompt string + version constant)
│   │   ├── chatService.ts               (orchestrates one turn)
│   │   └── recommendations.ts           (recommended models + min hardware notes)
│   └── tests/                           (vitest)
│
├── search/                              ← EXISTING (Phase 1, unchanged)
└── core/                                ← EXISTING

apps/desktop/
├── src/
│   ├── main/
│   │   ├── chatModule.ts                ← NEW (wires ChatService + OllamaClient at startup)
│   │   ├── ipc/
│   │   │   └── chatIpc.ts               ← NEW (archi:chat:* handlers)
│   │   ├── searchModule.ts              ← EXISTING (unchanged)
│   │   └── index.ts                     ← MODIFIED (register chatIpc + chatModule)
│   ├── preload/
│   │   └── index.ts                     ← MODIFIED (add window.archi.chat.*)
│   └── renderer/
│       ├── screens/
│       │   ├── ChatScreen.tsx           ← NEW
│       │   └── ChatSetupScreen.tsx      ← NEW
│       ├── components/chat/
│       │   ├── ChatMessageBubble.tsx    ← NEW
│       │   ├── ChatCitationList.tsx     ← NEW (reuses SearchResultCard)
│       │   ├── ModelPicker.tsx          ← NEW
│       │   ├── PullProgressBar.tsx      ← NEW
│       │   └── ChatStatusBadge.tsx      ← NEW (header "Local • Ollama (model)" pill)
│       ├── hooks/
│       │   └── useChatTurn.ts           ← NEW (manages one turn's streaming state)
│       └── App.tsx                      ← MODIFIED (add "Chat" to screens tuple + case)
```

## 6. Data flow for one Q→A turn

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Renderer: ChatScreen.send(question)                                          │
│   - generate turnId (uuid)                                                   │
│   - push placeholder bubble into history with { turnId, role: "assistant",   │
│     status: "streaming", text: "" }                                          │
│   - invoke "archi:chat:turn"                                                 │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ { turnId, question, history, modelName,
                                       │   options: { topK, includeArchived, ... } }
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Main: chatIpc.handle("archi:chat:turn", ...)                                 │
│   → ChatService.runTurn(req, sender)                                         │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ ChatService.runTurn:                                                         │
│                                                                              │
│   1. searchResults = await SearchService.query({                             │
│        text: question, mode: "hybrid", limit: topK ?? 8, filters: {...}      │
│      })                                                                      │
│                                                                              │
│      if searchResults.results.length === 0:                                  │
│        → emit "archi:chat:done" { turnId, citations: [], skipped: true,      │
│                                   skipReason: "no_passages" }                │
│        → return                                                              │
│                                                                              │
│   2. { system, messages } = buildRagPrompt(question, searchResults.results,  │
│                                            history)                          │
│                                                                              │
│   3. abortController = new AbortController()                                 │
│      activeTurns.set(turnId, abortController)                                │
│                                                                              │
│   4. for await (delta of llmClient.chat({                                    │
│        model: modelName, messages, system, signal: abortController.signal    │
│      })):                                                                    │
│        sender.send("archi:chat:token", { turnId, delta: delta.text })       │
│                                                                              │
│   5. sender.send("archi:chat:done", {                                        │
│        turnId,                                                               │
│        citations: searchResults.results,    // full SearchResult[]           │
│        durationMs, totalTokens                                               │
│      })                                                                      │
│                                                                              │
│   On error: sender.send("archi:chat:error", { turnId, code, message })      │
│   On abort (cancel IPC): catch AbortError, emit "archi:chat:aborted"         │
│   Finally: activeTurns.delete(turnId)                                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (event stream back to renderer)
┌──────────────────────────────────────────────────────────────────────────────┐
│ Renderer: useChatTurn hook                                                   │
│   - subscribes to "archi:chat:token" / ":done" / ":error" / ":aborted"      │
│   - filters by its turnId                                                    │
│   - appends deltas to the bubble's text                                      │
│   - on "done": renders citations via <ChatCitationList passages={…}/>        │
│   - on "error" / "aborted": renders the appropriate state                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Cancellation:** Renderer fires `archi:chat:cancel` invoke with `{ turnId }`. Main looks up the `AbortController`, calls `.abort()`. The fetch to Ollama dies; ChatService catches the AbortError and emits `archi:chat:aborted`. The partial answer stays visible (greyed) without citations.

## 7. IPC contract

All channels are namespaced `archi:chat:*`. The `chat` preload binding mirrors Phase 1's `search` binding.

```typescript
// preload/index.ts
window.archi.chat = {
  // Setup
  detect: (): Promise<DetectResult> =>
    ipcRenderer.invoke("archi:chat:detect"),
  listModels: (): Promise<ModelInfo[]> =>
    ipcRenderer.invoke("archi:chat:listModels"),
  pullModel: (name: string): Promise<{ started: boolean }> =>
    ipcRenderer.invoke("archi:chat:pullModel", name),
  onPullProgress: (cb: (p: PullProgress) => void) => {
    ipcRenderer.on("archi:chat:pullProgress", (_e, p) => cb(p));
    return () => ipcRenderer.removeAllListeners("archi:chat:pullProgress");
  },

  // Conversation
  turn: (req: ChatTurnRequest): Promise<{ accepted: boolean; turnId: string }> =>
    ipcRenderer.invoke("archi:chat:turn", req),
  cancel: (turnId: string): Promise<void> =>
    ipcRenderer.invoke("archi:chat:cancel", turnId),
  onToken: (cb: (e: { turnId: string; delta: string }) => void) => { ... },
  onDone: (cb: (e: ChatTurnDoneEvent) => void) => { ... },
  onError: (cb: (e: { turnId: string; code: string; message: string }) => void) => { ... },
  onAborted: (cb: (e: { turnId: string }) => void) => { ... },
};
```

**Channel summary:**

| Channel | Direction | Input | Output |
|---|---|---|---|
| `archi:chat:detect` | invoke | — | `DetectResult` |
| `archi:chat:listModels` | invoke | — | `ModelInfo[]` |
| `archi:chat:pullModel` | invoke | `name: string` | `{ started: boolean }` |
| `archi:chat:pullProgress` | event | — | `PullProgress` |
| `archi:chat:turn` | invoke | `ChatTurnRequest` | `{ accepted: boolean; turnId: string }` |
| `archi:chat:cancel` | invoke | `turnId: string` | `void` |
| `archi:chat:token` | event | — | `{ turnId, delta: string }` |
| `archi:chat:done` | event | — | `ChatTurnDoneEvent` |
| `archi:chat:error` | event | — | `{ turnId, code, message }` |
| `archi:chat:aborted` | event | — | `{ turnId }` |

Types (in `packages/chat/src/types.ts`):

```typescript
type DetectResult =
  | { status: "ready"; modelCount: number; ollamaVersion?: string }
  | { status: "no_models" }
  | { status: "not_installed" }
  | { status: "error"; message: string };

type ModelInfo = {
  name: string;            // "llama3.1:8b"
  size: number;            // bytes
  modifiedAt: string;
  recommended?: boolean;
};

type PullProgress = {
  name: string;
  status: string;          // raw from Ollama: "pulling manifest" | "downloading" | ...
  completed?: number;
  total?: number;
  done: boolean;
  error?: string;
};

type ChatTurnRequest = {
  turnId: string;
  question: string;
  history: ChatMessage[];  // last N turns only; renderer enforces window
  modelName: string;
  options?: { topK?: number; includeArchived?: boolean; includeHidden?: boolean };
};

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatTurnDoneEvent = {
  turnId: string;
  citations: SearchResult[]; // full Phase 1 type, including snippet + scores
  durationMs: number;
  skipped?: boolean;
  skipReason?: "no_passages";
};
```

## 8. Prompt & retrieval shape

System prompt (v1, in `packages/chat/src/prompt/systemPrompt.ts`):

```
You are answering questions about the user's personal collection of saved
reading passages. You are given a question and a numbered list of passages
the user has highlighted from their books.

Rules:
1. Answer ONLY from the provided passages. If they don't cover the question,
   say "I don't have passages that speak to that" and stop.
2. Cite passages by number in square brackets, e.g. [3]. Cite every claim.
3. Do not invent quotes. Quote verbatim or paraphrase — never both at once.
4. Be concise. Prefer 2–4 sentences unless the user asks for more.
```

User message format:

```
Passages:
[1] (Marcus Aurelius — Meditations) "Begin the morning by saying to thyself…"
[2] (Seneca — Letters from a Stoic) "It is not death that a man should fear…"
…
[8] (Epictetus — Discourses) "Some things are in our control…"

Question: what did the Stoics say about death?
```

The system prompt is versioned: `SYSTEM_PROMPT_VERSION = 1`. Future iterations bump the version so we can correlate quality regressions with prompt changes during dogfooding.

History inclusion: `messages: [{role: "user"}, {role: "assistant"}, ...]` standard OpenAI/Ollama chat shape. The system prompt + latest user turn carry the passages; earlier passages are re-shown by re-running search on each follow-up. **Per-turn retrieval semantics:** search runs only on the latest user message, not the cumulative conversation. This is a documented v2.0 limitation.

**Citation numbering:** numbers map 1:1 to `searchResults.results` order. The `ChatCitationList` renders the same passages as `SearchResultCard`s in that order, with the `[N]` label visible.

## 9. Setup flow & states

`ChatScreen` mounts → calls `window.archi.chat.detect()`. Result drives which sub-view renders.

| State | Trigger | UI |
|---|---|---|
| `not_installed` | `fetch http://localhost:11434/api/tags` rejects (ECONNREFUSED) | Setup screen: "Ollama is a free, local AI runtime. Install it and Archi can answer questions about your library — fully on-device." + [Download Ollama] (opens ollama.com via `shell.openExternal`) + [I've installed it, recheck] |
| `no_models` | API reachable, `models: []` | Setup screen: "Ollama is running but no models are installed. We recommend `llama3.1:8b` (~5 GB, runs well on M1+)." + [Pull llama3.1:8b] (streamed progress) + [Pick a different model] (manual name input) |
| `ready` (no preference saved) | API reachable + ≥1 model + `chat.modelName` unset | One-time model picker: list `/api/tags`, recommended ones first. Persist choice to `chat.modelName`. |
| `ready` (configured) | Everything set | Normal ChatScreen. |
| `error` | API reachable but `/api/chat` returns 5xx on test ping | "Ollama is running but something's wrong: <message>. Try restarting it." + Settings link |

`detect()` is called on app startup as well — single cheap HTTP ping. Result cached for the sidebar's Chat nav item, which renders a small dot indicator if `not_installed` (clickable to setup).

**Pull progress** uses Ollama's `/api/pull` streaming endpoint. `OllamaClient.pullModel()` parses the line-delimited JSON stream and yields `PullProgress` events; `chatIpc.ts` forwards them as `archi:chat:pullProgress` IPC events; `<PullProgressBar />` renders a progress bar from `completed/total`.

**Model picker** also shows a small "Recommended" pill on entries that appear in `recommendations.ts`. Picker accepts a free-form model name (`<input type="text">`) for users who want models we don't list.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Ollama becomes unreachable mid-turn | Cancel turn, render error bubble: "Ollama disconnected. Please restart it and try again." [Recheck] button. Don't clear user's typed question. |
| Search returns 0 results | Skip the LLM call entirely. Render: "No passages in your library matched that. Try a broader question, or [open Search]." Logged as `skipped: true, skipReason: "no_passages"`. |
| Model returns 4xx (model deleted out-of-band) | Re-run `listModels()`. If saved `chat.modelName` is gone, route user back to setup screen's model picker; restore on success. |
| Context overflow (rare with K=8) | Truncate from oldest history turns first; never truncate the latest passages. Single passage > 1500 tokens: truncate that passage's body at 1500 tokens with "…" suffix. (Passages are typically < 500 tokens.) |
| Pull download fails / interrupted | Surface Ollama's error verbatim; offer [Retry]. Ollama handles resume on retry. |
| User clicks Stop | `AbortController.abort()`. Turn marked `aborted`; partial answer visible (greyed). No citations rendered. |
| LLM ignores citation rule (no `[N]` references) | Out of our hands at runtime level. Mitigations: rule placement in prompt; always show the passages anyway. Phase 2.1 candidate: post-hoc grounding check ("does answer contain a [N] reference for each claim?") with a regenerate option. |
| LLM hallucinates a quote | Same mitigation surface as above. Users can verify against the visible passages. We do not attempt v2.0 hallucination detection. |

## 11. Privacy posture

This is marketing-relevant and will be scrutinized; locking it down:

- **Hardcoded localhost.** `OllamaClient` constructs `http://localhost:11434` as a literal constant. No environment override, no preference, no setting. Phase 2.x "use my remote Ollama" is a separate feature with its own threat model and a documented spec.
- **No prompt/completion telemetry.** Archi has no telemetry pipeline today; we do not add one in v2.0.
- **No persistence.** Session-only chat history. Document this explicitly in the empty state: "Conversations are not saved — close this window and they're gone." Set the expectation; let users who want persistence ask for it.
- **Visible status badge.** Chat screen header renders "Local • Ollama (`<model>`)" pill. Tooltip: "Your questions and your passages stay on this device. Nothing is sent over the network."
- **Marketing alignment.** Update the marketing site's feature surface to add "Local AI chat over your library" using the same "fully on-device" framing as Phase 1 search.

## 12. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Ollama install friction kills feature adoption | High | Invest in guided setup screen with clear copy and one-click [Pull recommended] button. Track via dogfooding whether users actually convert from "not_installed" to "ready". |
| Small models follow citation rules unreliably | Medium | Keep citation rule prominent in system prompt; always render the source passages independently; users verify visually. Phase 2.1 grounding-check is the next dial. |
| `llama3.1:8b` becomes stale; better default ships | Medium | Recommendations live in `packages/chat/src/recommendations.ts` — pure code change to update. Plan to revisit before each release. |
| Streaming token routing breaks on rapid send-cancel-send | Low | `turnId` per message + filtering in `useChatTurn` hook prevents cross-talk. Add a regression test. |
| Long conversation hits Ollama's context limit on smaller models | Medium | History truncation in `buildRagPrompt` (drop oldest first). Show a subtle "older context dropped" hint. |
| Recommended model's DMG/disk requirements aren't communicated | Medium | Setup screen shows model size before pull. "llama3.1:8b is ~5 GB. Pull?" |
| User changes `chat.modelName` to a non-existent model | Low | `chat()` request fails with 4xx; we route back to setup picker; preserve user's typed question. |
| Ollama version skew breaks API shape | Low | We use only the stable endpoints (`/api/tags`, `/api/pull`, `/api/chat`). Pin a min-tested version in setup copy ("Ollama 0.5+"). |
| Concurrent turns (user sends before previous done) | Low | Renderer disables Send button while a turn is active. Main rejects new turns for a given conversation with `accepted: false` if one is already running. |
| Phase 1 utilityProcess refactor lands later | Low | `ChatService` does not depend on EmbeddingService directly — only on `SearchService.query()`. Swapping the embedder's process boundary is invisible to chat. |

## 13. Testing strategy

| Layer | What we test | How |
|---|---|---|
| `packages/chat` unit — prompt | `buildRagPrompt()` output shape under various inputs (no history, long history, single passage, K passages, oversized passage requiring truncation) | vitest, snapshot-style + assertions on truncation invariants |
| `OllamaClient` | `detect()` handles ECONNREFUSED → `not_installed`; reachable+empty → `no_models`; reachable+models → `ready`; 5xx test ping → `error`. `listModels()` parses `/api/tags`. `pullModel()` parses the streamed `/api/pull` line-delimited JSON correctly. `chat()` parses `/api/chat` streaming response into `ChatDelta` chunks and honors AbortSignal | vitest + `undici` mock pool or `msw/node` |
| `ChatService` integration | Full Q→A turn against stubbed `SearchService` + stubbed `LLMClient`: assert prompt content, turnId routing, citation payload on done, AbortError → aborted event, 0-results → skipped event | vitest with stubs |
| IPC contract | `archi:chat:*` channel names match preload typing exactly; one smoke test wires preload → main and asserts a `detect` round-trip | TypeScript at the boundary + vitest |
| Renderer hook | `useChatTurn` filters events by turnId; concurrent turnIds don't cross-contaminate; abort transitions state cleanly | vitest + jsdom |
| Manual E2E | Documented in `docs/qa/chat-v2.md`: install Ollama → setup screen → pull `llama3.1:8b` → ask three corpus questions → verify citations link to passages → quit and reopen → confirm history is empty | Manual; one walk-through per release candidate |

No automated end-to-end against real Ollama. Runtime is too heavy and CI doesn't have GPUs. We trust unit + integration + a documented manual smoke pass.

## 14. Packaging

Almost nothing changes:

- `packages/chat` is a workspace package; pnpm picks it up automatically. No native deps; pure TypeScript + `fetch`.
- No bundled binaries (no model files, no Ollama, no Swift helper).
- No `verify-packaged-runtime.mjs` extension needed — chat has no native libs to check.
- No DMG size change from chat itself.

## 15. Migration & first-run experience

For users upgrading from v0.2.0 (Phase 1):

- Chat nav item appears in the sidebar. If Ollama isn't running, the item shows a small dot indicator.
- Clicking Chat for the first time lands them on the setup screen, not a broken-looking empty chat.
- No data migration. No DB schema changes. No re-index.
- Search continues to work exactly as before, independent of chat state.

For new users:

- Onboarding doesn't mention chat by default; it's a feature you discover from the sidebar. (Avoiding adding chat to the existing onboarding wizard keeps that path simple.)

## 16. Future considerations (not v2.0)

For the record, in rough priority order if Phase 2.0 lands well:

1. **Persisted chat history.** New `chat_conversations` + `chat_messages` tables; sidebar list of past chats with rename/delete. Likely Phase 2.1.
2. **Per-passage "Ask about this" drawer.** Re-uses ChatService with a single seeded passage; small UI add.
3. **Markdown export of answer + citations.** Trivial.
4. **History-aware retrieval / query condensation.** Tiny LLM call to rewrite the current question with context from the last 2-3 turns before search.
5. **Grounding check pass.** Post-hoc verifier: "does the answer cite [N] for each claim, and does each [N] actually support the claim?" Regenerate on failure.
6. **Apple FoundationModels adapter** for users on macOS 26+. Swift helper binary in resources; `LLMClient` impl shells out.
7. **Bundled llama.cpp adapter** for zero-install. Big-ticket; only if Ollama friction becomes the bottleneck.
8. **Tool-calling RAG.** When small-model function-calling is reliably good enough (probably 2027+).
9. **Remote Ollama** (`OLLAMA_HOST` / "use my home server"). Separate spec required for the threat model.

## 17. Open questions to revisit during implementation

Defaulted during design; surface once code is running:

- **Recommended model default.** `llama3.1:8b` is the safe pick today; check what's current in Ollama's ecosystem before shipping (the landscape moves quarterly).
- **Streaming UX.** Token-by-token or word-by-word render? Decide after seeing it; word-level often feels less janky for end-users.
- **Top-K default.** Start at 8; tune after dogfooding. Possibly expose under "Advanced" if power users care.
- **Skip threshold.** Hard-skip on `results.length === 0` is clear. What about "1 weak result with low fused score"? Maybe skip below a tuned score threshold; needs calibration data.
- **History window.** Defaulted to last 6 turns before truncation; refine after dogfooding longer conversations.
- **System prompt evolution.** Versioned via `SYSTEM_PROMPT_VERSION`. Watch dogfooding for cases where the model misfires; tune copy iteratively.
- **Stop button behavior on the last token.** Should "Stop" mid-final-newline still show citations? Probably yes (the answer is effectively done); decide once UX is in hand.

---

**Approved direction:** Phase 2.0 ships a local-private, BYO-Ollama chat layer that performs grounded synthesis over Phase 1's indexed corpus. One new package, one new IPC namespace, one new screen + a setup screen. No new SQLite objects. Session-only history. Hardcoded localhost. Designed behind an `LLMClient` adapter so FoundationModels and llama.cpp can plug in later without touching consumers.
