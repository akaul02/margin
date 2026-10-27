# Verification record · board and local collaboration

Verified on 2026-10-03 using synthetic material only. Final app release 2.0.0; project format 3.

## Final results

- `npm run typecheck`: passed, no TypeScript errors.
- `npm test`: **55 passed** across evidence/model, legacy migration, board and local-server tests.
- `npm run build`: passed. Production JavaScript ~341 KB / 104 KB gzip; CSS ~47 KB / 10 KB gzip.
- `MARGIN_TEST_PRODUCTION=1 npm run test:browser`: **30 passed** against the final production build in real installed Google Chrome, using isolated browser contexts and synthetic temporary server directories. Final full run completed in about 1.4 minutes.
- `node --check server/room-server.mjs` and `server/start.mjs`: passed.
- `npm ls --depth=0`: dependency graph valid.

## What was exercised

Evidence and reading: real mouse-drag selection; exact highlights and UTF-16 references; participant-only eligibility; interviewer context; roles initially unassigned; keyboard selection after CRLF/emoji; single-character boundary selection; unchanged original text; duplicate text/quote/import handling; protected evidence roles; code rename/merge; undo; user-authored memos; exact JSON round trips and CSV formula escaping.

Board: uncoded quote cards; keyboard Move and real drag-and-drop to the same group; card ordering model; manual groups; group removal retains cards and notes; explicit human comments with self-entered names; original context; refresh persistence; handoff to a separate browser preserves all project data, and later handoff edits remain independent.

Deeper tools retained: inclusion/exclusion guidance and selected source examples; side-by-side comparison and linked memos; manual theme links; reference-safe merge/removal/restore; descriptive source-and-speaker coding map; guided fictional practice does not insert interpretations.

Recovery: v1/v2 migrations preserve raw pre-upgrade backups, source text and IDs; valid legacy backups near their old 10/15 MB ceilings remain exportable; duplicate-ID corrupt records do not overwrite the valid legacy archive; damaged projects/history remain recoverable; history survives refresh and rolls at 20 points; malformed and >16 MB backups fail without altering work. Injected IndexedDB transaction/quota aborts leave both workspace and history unchanged. Disk rename failure leaves the server revision and file unchanged. Actual disk/quota exhaustion was not induced.

Local collaboration: **two independent browser contexts sharing through the HTTP/SSE server**, not through common IndexedDB; shared group creation, quote moves and notes; server restart persistence; concurrent server writes produce one successful commit and one conflict; stale local tabs cannot overwrite; offline edits can retry; a competing shared edit preserves the local draft as a separate project; unsaved note text survives remote card deletion; remote hydration clears stale Undo so another editor's work cannot be silently undone. Incoming shared changes pause during dialogs. Server tests also reject untrusted origins, missing mutation-intent headers, malformed JSON, changed original source text, project-ID changes and corrupt room files.

Accessibility/appearance: axe scans reported **zero violations** in the tested welcome, reader, quote library, code guidance, comparison, group editor, coding map, practice, board, notes and collaboration-dialog states, including selected dark and phone states. Real keyboard focus/Enter/Escape, precise text selection and Move controls were exercised. Reduced-motion behavior was checked on animated elements. Reflow was checked at 320, 390 and 720 CSS pixels. No non-loopback app requests were observed in the request-monitoring flow.

## Screenshots

22 screenshots are in `screenshots/`. Key views:

- `17-quote-board-desktop.png` — the primary sticky-note board.
- `18-quote-notes-desktop.png` — exact source context and separate human notes.
- `19-board-phone-dark.png` / `20-board-phone-light.png` — responsive board.
- `21-collaboration-options.png` — honest local live / file handoff choices.
- `22-local-shared-board.png` — connected board after edits from another browser.
- `09`–`16` — retained advanced tools and recovery; `01`–`08` — original reading/coding flows.

## Privacy and practical limits

Only fictional library/garden transcripts and synthetic test strings were used. Source, tests, server, documentation, manifests and production assets were scanned for common secret patterns and email addresses, with no matches. No credential contents were inspected, no new credentials or credits purchased, and no actual lab material was sent to Claude. Claude generated the isolated server module and supplied a bounded-source review; Codex independently integrated, reviewed and tested it.

No Git repository, commits, remotes, pushes, publication, deployment or lab messages were created. Runtime server directories and browser data are excluded from the deliverable archive. Original v1 delivery and pre-upgrade source backups remain available.

This verifies **local** multi-client synchronization. Cross-computer/remote access, hosted deployment, authentication, permission enforcement, physical phone browsers, Safari/Firefox, manual screen-reader testing and industrial-scale corpus/load testing were not performed. The loopback service has no authenticated users and must not be publicly exposed as-is. Data is unencrypted locally. Histories are bounded rolling recovery points; exported backups are still needed. No claim of WCAG certification or qualitative methodological correctness is made.
