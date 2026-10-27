## Review — ceal-margin (supplied model/storage/UI excerpts only)

### 1. One invalid project blocks the entire workspace — Medium-High (data availability)
`src/storage.ts` `loadWorkspace`: `data.projects.map(validateProject)` rejects the whole promise if *any* project fails validation, and `App` surfaces that as a terminal `loadError`. A single corrupted or newly-rejected project locks the user out of every other project; recovery depends on `rawWorkspace()` plus manual JSON surgery.
**Fix:** validate per project, keep the valid ones, and surface the failures as a quarantined list (name + reason + raw export) rather than failing the load.

Compounding this, `validateProject` uses `toLocaleLowerCase()` for duplicate transcript/code-name checks (`model.ts`). Locale-sensitive casing on a *restore* path means a project that validated when written can fail later (host locale change, Turkish dotted/dotless I). Structural validation should use `toLowerCase()`; keep locale casing only for user-facing comparison in `addCode`/`makeTranscript` if desired.

### 2. Offsets are trusted; stored passage can differ from the one shown — Medium (correctness of evidence)
`assignQuote` recomputes `text: t.text.slice(start, end)`, which correctly guarantees quotes are never paraphrased — but it never compares against what the user actually selected. Both producers of `Selection` compute offsets indirectly: `captureSelection` from `Range.toString().length` within `[data-turn-text]`, and `PassageDialog.useRange` via `sourceOffsetFromTextarea`. Any drift (stray non-source text inside the turn element, normalization difference) yields a *valid but wrong* passage, saved silently and indistinguishable afterwards.
**Fix:** pass `selection.text` through to `assignQuote` and throw if `t.text.slice(start, end) !== selection.text`. Cheap, and it converts a silent mis-attribution into a blocked save.

### 3. PassageDialog mixes textarea (LF) indices with source (CRLF) slicing — Medium
`PassageDialog`: `range` holds textarea offsets, but the enable guard `body.slice(range.start, range.end).trim()` and the counter `range.end - range.start` slice/measure `body`, which is raw source and may contain `\r\n`. The *saved* range is mapped correctly through `sourceOffsetFromTextarea`, so no bad data is written — but on CRLF transcripts the character count is wrong and the whitespace-only guard tests the wrong substring, so a whitespace-only selection can be enabled (then rejected downstream by `assignQuote`) or a valid one disabled.
**Fix:** map first — `const a = sourceOffsetFromTextarea(body, range.start), b = …(body, range.end)` — then guard and count on `body.slice(a, b)`.

### 4. Recovery read can never settle — Low
`rawWorkspace` has no `tx.onabort` handler and no `db.close()` on failure; if the transaction aborts the promise hangs and the connection leaks. This is precisely the path used when storage is already misbehaving.
**Fix:** add `tx.onabort = () => { db.close(); reject(tx.error); }`.

### 5. Stale selection after a silently rejected capture — Low
`captureSelection` returns without clearing state when `end > turn.end` or the span is whitespace-only, so the previously picked selection (possibly another turn) stays active and `applyCodes` can code it.
**Fix:** `setSelection(null)` plus an explanatory message on those branches.

### 6. Minor / non-blocking
- `change()` gates on `exportProject(next).length > 10_000_000` (UTF-16 units) while `exportProject` itself gates on bytes; the inner byte check is stricter, so behaviour is correct but the duplicate is misleading — drop it.
- CSV formula prefix `/^[\s]*[=+@-]/` misses a leading BOM/zero-width char before the operator.

### Invariants that appear to hold
Transcript `text` is never mutated on any supplied path; turn/quote ranges are UTF-16, end-exclusive, non-overlapping and re-verified against source text on both import and restore; only `role === 'participant'` turns accept quotes (enforced in `assignQuote`, `setRole`, and validation); memos are pinned to `author: 'user'`; `importProject`/`exportProject` round-trip through `validateProject` with byte preflight; `saveWorkspace` performs read-check-write inside one `readwrite` transaction, which IndexedDB serializes, so the cross-tab guard is genuinely atomic; no network calls appear anywhere in the supplied code (downloads use `Blob`/object URLs, `localStorage` holds only the theme).

**Scoped review outcome:** Material issues found — one Medium-High availability bug (#1, with the locale-casing contributor), two Medium correctness/UX bugs (#2, #3), and three Low issues (#4–#6). No evidence of transcript mutation, paraphrased quotes, fabricated memos, non-atomic saves, or external data egress in the excerpts provided. Review limited to `model.ts`, `storage.ts`, and the two `App.tsx` excerpts; `demo.ts`, memo/code/transcript-deletion UI, import/restore dialogs, and styling were not supplied and are not covered. No tests were run or inferred.
