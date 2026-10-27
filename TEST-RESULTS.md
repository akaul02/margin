# Verification record · Astra max audit checkpoint

Verified on 2026-10-04 using synthetic material only. Release **2.1.1**; project format **3**. Verified before midnight 2026-10-03 America/New_York. Earlier verification records are preserved in `docs/V2-TEST-RESULTS.md` and `docs/V2.1-TEST-RESULTS.md`.

## Final results

- `npm run typecheck`: passed, no TypeScript errors.
- `npm test`: **111 passed** in 8 files: 43 model/advanced, 5 board, 29 operation, 7 original server, 21 operation-server, 4 draft-recovery and 2 dev/preview privacy tests. Final run took about 1 second.
- `npm run build`: passed. Production JavaScript 366.75 KB / 112.27 KB gzip; CSS 47.96 KB / 10.22 KB gzip.
- `MARGIN_TEST_PRODUCTION=1 npm run test:browser`: **50 passed** against the final production build in installed Google Chrome, using isolated browser contexts and synthetic temporary room directories. Final full run took 2.1 minutes.
- `node --check` passed for `server/room-server.mjs`, `server/start.mjs` and `shared/operations.mjs`.
- `npm ls --depth=0`: dependency graph valid. Dependencies were not changed during this correction pass.

## Astra max findings and new regressions

An independent **gpt-6-astra** reviewer with reasoning effort **max** found that Vite's development static-file routes could expose a synthetic local room despite the API's origin guards. The fix blocks default/custom room directories in dev and preview, keeps existing sensitive-file denies, disables unused public-directory serving and disables cross-origin asset reading. Automated tests exercise direct paths, `/@fs`, raw/import queries, custom room locations and unaffected home pages. Astra independently checked 28 additional encoded/custom-path cases; no private marker was returned.

Browser tests verify that declining Escape/Cancel/Close preserves an unfinished transcript through role review, and a delayed shared import locks controls until the submitted text is saved. Malformed draft records remain downloadable byte-for-byte while valid writing can still be viewed and restored. Recovery also passed an axe scan in the damaged-record state. Unit tests cover malformed metadata/content/link types, legacy keys, unfinished valid fields and project-scoped generation selection. See [the Astra review](docs/ASTRA-MAX-REVIEW.md).

## Existing concurrency and writing-recovery checks

Two independent browser profiles edit different existing notes from the same base and both save. Competing edits to one note retain the server winner and the complete local project; explicit resolution can add the other writing as a separate note. Delete/edit races preserve rejected text without resurrecting the server record. Server tests exercise both orderings of note deletion/edit and quote deletion/new note, including atomic rejection of dangling references.

The browser suite aborts a response after its operation has committed, adds later remote work, reloads and retries the original operation ID. The retry produces no duplicate note or extra history entry and includes the newer work. Server tests repeat this across a normal restart, concurrent identical retries, reused IDs with altered payloads, and a full 50,000-receipt ledger. Injected atomic-rename failure leaves state and receipts unchanged; the original retry then succeeds. The suite also tests stable room-creation IDs, failure/reload recovery and a late creation acknowledgement after another tab has committed a newer note.

Unsaved existing-note writing survives reload while someone else changes the shared note. Direct restoration refuses to overwrite the new version; explicit separate restoration keeps both. New memos and drafts whose quote was deleted remain recoverable. Recovery in another tab removes only the submitted generation, preserving newer typing for both existing and newly created drafts. Draft quota errors are visible; close, Escape, switching notes and source navigation guard in-memory writing when storage failed. Injected IndexedDB aborts preserve the previous workspace/outbox and the separate writing draft.

Offline dependent operations replay in order while an independent remote note edit survives. Stale tabs reject their save and recover writing after reload. Scoped Undo preserves unrelated remote changes and refuses a record another reader changed. Unchanged edits leave sharing clean. Leaving a session in another tab during a delayed response stops further retry attempts. Incoming updates pause during open dialogs.

## Existing functionality reverified

Evidence and reading: real mouse selection, exact highlights and UTF-16 offsets, participant-only eligibility, interviewer context, initially unassigned imported roles, keyboard selection after CRLF/emoji, one-character boundary selection, immutable original text, duplicate transcript/quote/import checks, protected evidence roles, code rename/merge, human-authored memos, lossless project round trips and CSV formula escaping.

Board and deeper tools: uncoded quote cards, keyboard Move and real drag-and-drop, group removal retaining cards and notes, explicitly human comments with unverified names, source context, refresh persistence, independent file handoffs, code guidance/examples, linked comparison memos, manual theme links, reference-safe removal/restore, descriptive coding maps and fictional practice prompts that add no interpretations.

Migration and storage: format-1/2 upgrades preserve raw pre-upgrade backups, source text, IDs and spans. Near-limit legacy backups remain exportable. Duplicate-ID damaged records cannot overwrite the valid archive. Damaged projects and history remain available for recovery. History survives reload and rolls at 20 points. Malformed and oversized backups do not alter existing work. Injected transaction/quota aborts and disk-rename failures preserve the prior committed state. Old room files without operation receipts remain readable, and the legacy revision endpoint preserves receipt metadata.

Accessibility and appearance: axe scans reported **zero violations in tested states**, including welcome, reader, library, code guidance, comparison, grouping, coding map, practice, board, notes, collaboration, conflict review and draft recovery. Selected dark and phone states were covered. Real focus, Enter/Escape, keyboard passage selection and Move controls were exercised. Reduced motion was checked on animated elements. Reflow was checked at 320, 390 and 720 CSS pixels. The request-monitoring flow observed no non-loopback app requests.

## Screenshots

27 screenshots in `screenshots/` were captured from the production build. Start with:

- `17-quote-board-desktop.png` — the primary quote board.
- `18-quote-notes-desktop.png` — exact context and distinct human notes.
- `19-board-phone-dark.png` / `20-board-phone-light.png` — responsive board.
- `23-note-conflict-review.png` — local/shared version review.
- `24-note-conflict-phone.png` / `26-note-conflict-phone-actions.png` — phone conflict review and its actions.
- `25-recovered-writing.png` — preserved draft and explicit refusal to overwrite changed writing.
- `27-damaged-draft-recovery.png` — a healthy draft remains usable beside damaged records retained for download.

The conflict test was rerun after adding a two-frame wait for the phone viewport to finish painting before capture. Application code and build were unchanged by that capture-only adjustment.

## Privacy and practical limits

Only explicitly fictional library/garden conversations and synthetic test strings were used. `docs/PRIVACY-CHECK-V2.1.1.json` records the final source/build/package scan. No credential contents or private browser/server records were read. The preceding correction pass found Claude unavailable. This pass used gpt-6-astra at max for read-only review and privacy-patch verification; Codex implemented and tested the fixes. Earlier Claude contributions remain documented separately.

No project Git repository, commits, remotes, pushes, publication, deployment or lab messages were created. Runtime room directories, browser state, dependencies, caches and private files are excluded from the delivery archive. Earlier deliveries and pre-change snapshots remain intact.

The tested guarantee is one Node process serving multiple browser clients on the same computer. Independent records merge; simultaneous edits within one record require a decision. No distributed-process locking, remote hosting, authentication or per-user access control was added. Histories are rolling and operation receipts have a fixed cap. Draft downloads are separate from project exports. Local data is unencrypted.

Reloads, interrupted HTTP responses, offline state, injected storage failures and normal server restarts were tested. Actual process-kill/browser-crash/power-loss recovery, physical disk exhaustion, multi-server use, physical phone hardware, Safari/Firefox, manual screen-reader operation and maximum-scale load were not tested. Browser eviction or storage clearing can remove work; regular exports remain necessary. This is not a WCAG certification or a claim of qualitative methodological correctness.

The approved Vercel CLI route was checked read-only using the installed cached CLI 59.25.2. Authentication succeeded; the only observed team was Hobby, its three projects were unrelated, and it had no marketplace installations. No private runtime data was inspected, account settings changed or hosted app deployed. The database/authentication provider and account connection remain the hosting decision; no hosted persistence or membership guarantee is claimed.
