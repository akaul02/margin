# Review: v2 upgrade (Workbench.tsx, storage.ts, ui.tsx)

Scope note: `model.ts` (`validateProject`, `coverageRows`, `coverageCSV`, `copy`, `required`, `byteLength`) and `App.tsx` (`change`, `Workspace` round-trip) are not in the excerpt, so two findings below are stated as conditional on their contents and marked **verify**.

---

## P1 — Can lose work or hard-block the app

**1. `busy` latches forever when `change` rejects → unescapable modal (worst case: reload required)**

`HistoryPanel`'s restore dialog: `setBusy(true); if (await change(...)) ...; setBusy(false);` has no `try/finally`, and the same dialog is gated by `close={() => { if (!busy) setChosen(null); }}`. If `change` throws rather than returning `false` (storage unavailable, `openDB` reject, validation throw), `busy` stays `true`: the X button, Cancel, and `onCancel`/Esc are all dead. The user is trapped in a modal with no keyboard exit — a reliability *and* accessibility failure.

Same missing `finally` in `GroupEditor`'s submit and its "Remove grouping" handler (Save/Remove permanently disabled; only Cancel, which discards the draft). `ComparisonEditor` has `finally` but no `catch`, so a rejection leaves the button re-enabled with **no error shown** — Save looks like a silent no-op.

Fix: in all four handlers, `try { ... } catch (e) { setError((e as Error).message); } finally { setBusy(false); }`. Never gate a dialog's close path on `busy`; allow close and cancel the pending state instead.

**2. Restore-point pruning can permanently wedge saving, and blocks the main thread on every save**

In `saveWorkspace`:

```
while (points.length > 20 || (points.length > 1 && byteLength(JSON.stringify(points)) > 20_000_000)) points.shift();
```

- `JSON.stringify(points)` is recomputed every iteration — O(n²) over up to ~20 MB of project data, synchronously, inside an open readwrite transaction. Multi-second freeze on each edit for a large project.
- `points.length > 1` means a *single* checkpoint larger than the budget can never be pruned. Once one exists, every save re-serializes an oversize array and `store.put` will hit quota → `tx.onabort` → the user's edit is rejected with "This change could not be saved…". The app becomes read-only, and the only remedy offered (download a backup) does not clear the bad checkpoint. Note the budget check runs *after* `push`, so an oversize project trips this on its first checkpoint.

Fix: compute `byteLength` of the serialized *new* checkpoint once, prune by a running size array without re-stringifying, and if the single new checkpoint exceeds the budget, **skip the checkpoint and still commit `next`** (surface a non-blocking "this version was too large to keep a restore point"). Losing a restore point must never cost the user their edit.

**3. Non-null assertions on cross-entity references crash the whole view at render time**

`Evidence` does `p.transcripts.find(...)!`, then `const i = t.turns.findIndex(...)` and immediately `t.turns[i].label` / `t.turns[i]` — `i === -1` is a `TypeError`. It also does `p.codes.find(x => x.id === id)!` on `q.codeIds`. Callers compound it: Codebook `c.exampleQuoteIds.map(id => p.quotes.find(q => q.id === id)!)`, theme cards `g.quoteIds.map(...)!`, `Comparison`'s `<option>` label, and `Coverage`'s cell filter `...turns.find(t => t.id === q.turnId)!.label`. There is no error boundary in this excerpt, so one dangling ID blanks the workbench with no recovery affordance.

Two paths, both need handling:
- If `validateProject` enforces referential integrity (**verify**), then deleting a quote/turn/code that a theme or codebook example references makes the project invalid, `change` returns `false`, and the user sees the generic "was not saved" message with no indication *which* grouping blocks the delete. Add a pre-delete reference check that names the blocking groupings/codebook examples and offers to unlink.
- If it does not, a restored or imported project can render-crash. Make `Evidence` tolerant: resolve transcript/turn/code with optional chaining and render an explicit "referenced passage is no longer in this project" placeholder; have callers filter unresolvable IDs before mapping.

---

## P2

**4. Only `version === 1` raws are preserved before the first write; quarantined v2 projects can be destroyed. (verify `Workspace` round-trip)**

`loadWorkspace` quarantines any project failing `validateProject` into an in-memory `quarantined` array. `saveWorkspace` persists raw copies only for `raw?.version === 1`. If `App` does not carry `quarantined` back into the `next` it passes to `saveWorkspace`, the first successful save overwrites `'current'` and the unreadable project is gone — exactly the data the user most needs. Fix: in the same transaction, `store.put(raw, \`quarantine:${id ?? uid()}\`)` for every raw project absent from `next.projects`, independent of `version`, and surface those keys in `rawWorkspace`/recovery download.

**5. `HistoryPanel` re-validates all restore points on every edit**

The effect depends on `[p.id, revision]`, and `loadHistory` → `validPoints` runs `validateProject` over up to 20 complete projects. With the panel open, every single edit triggers a full re-validation of the entire history (potentially ~20 MB) on the main thread. Fix: store/read lightweight metadata (id, label, createdAt, entity counts) for the list, and validate a point's `project` only when the user opens "Review restore"/"Restore". The counts shown in the list and the restore table are the only project data the UI needs up front.

**6. The "could not be read" banner is permanently sticky**

`loadHistory`'s `corrupt` flag ORs in `keys.result.some(k => String(k).startsWith(\`history-corrupt:${projectId}:\`))`. Because `saveWorkspace` never removes those quarantine keys, the red error block persists forever after a single corruption event — including after the user downloads the recovery file — with no dismiss control. Fix: after a successful recovery download, delete (or move to an acknowledged-prefix) the `history-corrupt:` keys, or separate "corruption happened once, data preserved" from the actionable alert and make it dismissible.

**7. `rawHistory` scans the entire object store**

`openCursor()` with no key range walks every record — including `'current'` and every *other* project's history — deserializing each value just to keep three keys. On a multi-project workspace this is a large, avoidable memory spike in the one code path that runs when storage is already suspect. Fix: `store.get(\`history:${id}\`)`, `store.get(\`v1:${id}\`)`, plus `getAllKeys(IDBKeyRange.bound(\`history-corrupt:${id}:\`, \`history-corrupt:${id}:\uffff\`))` and targeted gets.

**8. `required()` failures inside the mutator surface as a generic save error**

`ComparisonEditor` and `GroupEditor` call `required(title, 'Memo title')` *inside* the `change` mutator. A whitespace-only title passes the HTML `required` attribute, then throws in the mutator; the user sees "…was not saved. Your draft is still here; see the workspace message" rather than "Memo title is required", and the real reason lands in a different region of the page. Fix: `const t = title.trim(); if (!t) { setError('Add a title…'); focus the input; return; }` before calling `change`, and pass the trimmed value.

---

## P3

**9. `Comparison` selection state goes stale.** `left`/`right` initialize from `p.quotes[0]?.id` once. After a delete or a restore, the stored IDs may no longer resolve; `a`/`b` become `undefined`, the memo button silently disables, and the column falls back to the empty prompt with no explanation. Reconcile in an effect/derived guard: if a selected ID is absent from `p.quotes`, clear it and show "the passage you had selected is no longer in this project".

**10. Disclosure contents render eagerly.** `<details>` children mount whether or not the element is open, so every codebook example and every theme quote link renders a full `Evidence` (each slicing transcript text three times, plus a nested `<details>`) on every workbench re-render — including on each keystroke in `GroupEditor`'s search while a dialog is open. Gate on `open` state (`const [open,setOpen]` + `onToggle`) and render children only when open.

**11. Focus restoration can drop to `<body>`.** `Dialog`'s cleanup captures `document.activeElement` at mount and calls `previous?.focus()` on unmount. The triggers here live inside lists that re-render (`Review restore` in `history-list`, cell buttons in the matrix, `Edit grouping`); if that node is replaced, `focus()` is a no-op on a detached element and keyboard position is lost. Pass an explicit return-focus target or re-query by a stable selector. Also: `subtitle` is not wired to `aria-describedby`, so the dialog's methodological framing ("Your interpretation, linked to two exact participant quotes", the restore-point counts) isn't announced with the dialog name.

**12. `HistoryPanel` has no loading state.** While `history === null` the panel renders only the heading and method note — no `aria-busy`, no live-region text, and the `Empty` state is also suppressed. On slow storage this reads as a broken panel. Add an explicit "Reading restore points…" with `aria-live="polite"`.

**13. `r.counts[c.id]` may be `undefined`.** The cell renders `{r.counts[c.id]}` and `aria-label={\`…: ${r.counts[c.id]} quotes\`}` — if `coverageRows` only populates codes with hits (**verify**), screen readers announce "undefined quotes" and the cell is visually blank where the method note promises a zero. Coerce `?? 0` at the render site regardless.

**14. Speaker-local grouping keys on the raw `label` string.** `coverageRows` rows are keyed `${transcriptId}:${speaker}` and `Coverage`'s drill-in matches `turn.label === cell.speaker`. Labels differing only by case or trailing whitespace ("P1" vs "P1 ") split into two rows that look identical; `role` is not part of the key, so a non-participant turn sharing a label folds into the same row. Normalize (trim + case-fold for the key, keep the display form) and include `role` in the key, or state in the method note that grouping is by exact label text.

**15. CSV export is not injection-guarded (verify `coverageCSV`).** Code names and speaker labels are user text that flows into a `.csv` the user will open in Excel/Sheets; a code named `=HYPERLINK(...)` becomes a live formula. Prefix any cell beginning with `= + - @ \t \r` with a `'`.

**16. Order-sensitive dirty check.** `GroupEditor`'s `dirty` compares `JSON.stringify(codeIds)` against the original, so unchecking and rechecking the same code (now in a different array position) marks the form dirty and triggers "Discard your unsaved writing?" on Cancel for a no-op edit. Compare as sets, or preserve original order on toggle.

**17. `beforeunload` guard.** `useDraftGuard` only calls `e.preventDefault()`. For older Safari/Firefox, also set `e.returnValue = ''`.

---

## Minor / correctness notes

- `saveWorkspace`'s `tx.onerror = () => {}` swallows the diagnostic without `preventDefault()`, so the abort still fires and the user always gets the generic quota message. Capture `tx.error`/`request.error` into the rejection text so a quota failure is distinguishable from a constraint failure.
- The v1 preservation loop re-`put`s `v1:${id}` on every save for as long as a v1 raw remains in `'current'`; harmless but worth a `getKey` guard so a pre-upgrade backup can never be overwritten by a later, already-mutated raw.
- `HistoryPanel`'s restore uses `Object.assign(next, copy(chosen.project))`, which merges rather than replaces. It is safe only because `validateProject` normalizes every point (keys present with empty new fields); if a future field is added without a migration default, stale current-project values will survive a restore. Prefer replacing the project object in `next.projects` wholesale. Separately, restoring resets `updatedAt` to the saved value, so the project will read as "last edited" before the restore actually happened.
- `Coverage` makes every zero cell a focusable button that opens an empty dialog — on a 10-source × 15-code map that is 150 tab stops to reach the export control. Consider rendering zeros as plain text within the cell (keeping the count in the row/column headers' context) and making only non-zero counts interactive.
