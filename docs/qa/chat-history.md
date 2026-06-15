# Chat History QA

Run `pnpm dev` from repo root, then through each path below.

## Persist + resume
- [ ] Open Chat. Send "What is wisdom?". Verify a conversation row appears in the rail with the title "What is wisdom?".
- [ ] Send a follow-up turn in the same conversation. Verify the rail row stays a single entry and moves to top.
- [ ] Click `+ New chat`. Verify the transcript clears and the rail row is no longer marked active.
- [ ] Submit a turn in the fresh chat. Verify a new rail row appears.
- [ ] Quit the app. Re-launch. Verify both conversations are still in the rail and ordered newest-first.

## Resume into existing conversation
- [ ] Click a past conversation. Verify the transcript hydrates with the user + assistant messages.
- [ ] Send a follow-up. Verify it joins the same conversation (no new row appears).

## Rename
- [ ] Hover a conversation; click the kebab → Rename. Edit the title; press Enter. Verify the title updates without page reload.
- [ ] Repeat with Escape. Verify nothing changes.

## Delete
- [ ] Hover a conversation; click the kebab → Delete. Confirm. Verify the row disappears.
- [ ] Quit and relaunch. Verify it's still gone.

## Collapse rail
- [ ] Click the « toggle at the rail bottom. Verify the rail collapses to icons + dots.
- [ ] Click an active dot. Verify it expands back (or the rail toggle re-expands it).
- [ ] Reload renderer (Cmd-R). Verify the rail preserves its collapsed state.

## Edge cases
- [ ] Submit a question with no matching passages. Verify the conversation is created with status `skipped` for the assistant message, and the rail shows the row.
- [ ] Stop Ollama (or use a bogus model name) and submit a turn. Verify the conversation is created and the assistant message persists with status `error`.
- [ ] Abort an in-flight turn mid-stream. Verify the partial response is persisted with status `aborted`.

## Empty state
- [ ] On a fresh install (delete `~/Library/Application Support/Archi/chat.sqlite`, then relaunch), verify the rail shows "Your conversations will appear here." with a fleuron.
