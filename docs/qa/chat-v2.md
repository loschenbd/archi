# Chat v2.0 — Manual QA Checklist

Run before tagging a release that includes Phase 2 chat.

## Setup paths

- [ ] Fresh Mac without Ollama: Chat screen lands on "not_installed" state. [Download Ollama] opens ollama.com in browser. [Recheck] correctly re-runs detect.
- [ ] Ollama running, no models: setup lands on "no_models". [Pull llama3.1:8b] starts pulling; progress bar updates from real bytes; on completion, advances to model picker.
- [ ] Ollama running with one model already: model picker lists it with "Recommended" pill if appropriate. Selecting and clicking "Use this model" persists and enters chat.
- [ ] Setting `chat.modelName` to a model name that doesn't exist: chat screen surfaces an error on first send and routes back to setup (model picker).

## Chat behavior

- [ ] Single question, single answer: tokens stream visibly. On done, 8 citation cards appear below answer. Clicking a citation navigates to Library with the correct work.
- [ ] Citations are numbered [1]…[N] matching the order in the response text.
- [ ] Multi-turn follow-up ("now what about Seneca specifically?") renders correctly; cumulative transcript visible.
- [ ] Question with no relevant passages: skipped state shown ("No passages matched"). No LLM call (verify in Ollama logs).
- [ ] Click Stop mid-stream: answer freezes, greyed, no citations. Input is re-enabled.
- [ ] Click "New chat": transcript clears; previous turn IDs no longer route events.
- [ ] Quit and reopen Archi: chat transcript is empty (session-only).

## Privacy / status

- [ ] Header shows "Local · Ollama (llama3.1:8b)" badge.
- [ ] Tooltip on the badge reads the privacy promise.
- [ ] No network requests to anything other than localhost:11434 during a turn (verify with `nettop` or Charles).

## Regression

- [ ] Phase 1 search still works exactly as before (Home search hero, ⌘K, Find similar).
- [ ] No new errors in the main-process console.
- [ ] No new errors in the renderer DevTools console.
