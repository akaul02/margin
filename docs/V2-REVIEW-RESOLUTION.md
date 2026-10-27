# Board and local collaboration review record

2026-10-03. Only synthetic material was used. Original v1 source delivery and pre-upgrade ZIP remain outside the project folder. Completed advanced functionality was kept, while the quote board became the primary experience after user clarification.

## Claude contribution

The already installed/authenticated Claude Code CLI was invoked with safe mode, strict MCP configuration, tools disabled and no session persistence. Bounded synthetic code was supplied through stdin; no credential files or private research were read. Its workbench/storage review is retained in `CLAUDE-V2-REVIEW.md`. Claude then generated the standalone local room-server module; Codex reviewed and saved it as `server/room-server.mjs`, integrated it, and added independent server and browser tests. No credits were purchased. Review findings were assessed against the actual model and App, which were outside parts of Claude's excerpt.

## Material fixes

- Evidence navigation buttons inside memo forms now have an explicit non-submit type. Canceling navigation cannot submit a draft.
- Format-1/2 imports migrate to format 3; exact source text, IDs and spans remain intact. The 16 MB current cap accommodates valid near-limit format-1 (10 MB) and intermediate format-2 (15 MB) upgrades. Pre-upgrade records are immutable, and duplicate/quarantined project IDs cannot overwrite the valid original archive.
- Persistent history writes, legacy backups and workspace commits are atomic. Bounded history byte accounting avoids repeatedly serializing the entire list while pruning. Targeted recovery reads avoid scanning unrelated project values. Corrupt histories are retained separately.
- Model validation covers guidance/examples, theme/memo links, board membership and comments. Uncoded cards still require exact participant provenance. CSV retains them. Moves leave codes, advanced themes, comments and source references unchanged; card removal detaches dependent links and prompts before removing notes.
- Dialog labels/descriptions, focus fallback, field names and reduced-motion handling were tightened. Critical editor actions retain drafts on failure. Default button behavior and actual keyboard interactions were regression-tested.
- Server writes check revision inside a serialized per-room queue and notify clients only after atomic replacement. Codex added original-source/stable-quote checks across revisions, file-type/size checks before reads, head/history consistency checks and strict fsync failure handling. Default development/preview stores are separate.
- Shared edits are first saved locally with pending sync metadata. Stale shared revisions cannot overwrite another editor. Offline retry and conflict-copy recovery were tested using independent browser contexts.
- Remote hydration pauses whenever a dialog is open, preserving unsaved drafts and their prior shared revision. Incoming changes clear session Undo so an old whole-project snapshot cannot erase another editor's later edit. Explicit restore points remain available.
- Preservation copies created when joining or resolving conflicts are preflighted for export size before persistence.

## Deliberate limits

This is loopback-only collaboration through one server on one computer, with unverified display names. No hosted access, login, per-user authorization, remote transcript transfer, operation-level merges, live cursors or formal audit certification is claimed. File handoff is a separate-copy workflow. Project and room histories are rolling, not permanent archives. Source text is immutable; human notes are distinct from source evidence. Automated counts describe saved coding activity, not importance or representativeness.

Claude's conditional warnings about missing reference checks, omitted quarantined projects, CSV injection and undefined coverage cells were checked against the full implementation: model validation, reference cleanup, quarantined-data preservation, formula escaping and explicit zero counts already cover them. Large-corpus rendering and whole-project synchronization remain a practical scale limit rather than a claim of industrial-scale performance.
