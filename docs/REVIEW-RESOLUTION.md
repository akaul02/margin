# Review resolution

Claude Code authentication was confirmed via the supported `claude auth status` command in the normal local environment. A real invocation returned “Claude review connection ready.” The saved scoped review was produced by the existing authenticated Claude account with built-in tools disabled, safe mode enabled, and only the bounded brief plus synthetic app source as input. No credential contents or private research were supplied. The retained review covers the model, storage, data-operation UI, and passage-selection UI excerpts; it is not a whole-app design certification.

The implementation agent reviewed each finding independently and applied these changes:

| Claude finding | Disposition and evidence |
| --- | --- |
| One invalid project blocks the workspace | Fixed. Local loading validates projects individually and quarantines rejected raw records. Healthy projects stay usable; every subsequent save preserves quarantine. A real-browser regression corrupts one synthetic record, saves another project, refreshes, and downloads the retained raw record. |
| Locale-sensitive restore checks | Fixed. All model name comparisons use deterministic `toLowerCase()`. A model test preserves dotted/dotless-I code names through round trip. |
| Quote differs from displayed selection | Hardened. UI passes its frozen selected text into `assignQuote`; mismatches are rejected. Mouse selection is compared directly with the source slice before it enters the code tray. Exact pointer and keyboard flows remain covered. |
| CRLF selection guard/count uses normalized indices | Fixed. The guard and count use mapped source indices. A browser regression selects a single letter following CRLF plus whitespace. |
| Recovery read can hang on abort | Fixed. `rawWorkspace` rejects aborted transactions and closes the connection on error/abort. This rare failure branch was code-reviewed; forced browser storage abort testing is not claimed. |
| Invalid capture retains an earlier selection | Fixed. Out-of-range, whitespace-only, or mismatched captures clear the code tray and explain how to retry. |
| Redundant character size gate | Removed. Canonical JSON export performs the single authoritative UTF-8 byte check before saves. |
| Spreadsheet formula protection with invisible prefixes | Hardened for zero-width prefixes and covered by a model test. JavaScript `\s` already includes a BOM, so the original BOM part of the concern did not reproduce. |

Additional Codex review and browser fixes are recorded in `CODEX-REVIEW.md`. The synthetic demo now requires explicit confirmation that newly imported material is fictional. Memos protect unsaved edits against accidental close and request the browser's normal unload warning while dirty.

All final automated results are recorded in `../TEST-RESULTS.md`. No independent reviewer is claimed to have rerun the browser suite; Codex performed the final execution and checked results.

A final independent Codex spot-check confirmed CRLF mapping and quarantine preservation, and caught a near-limit duplicate-copy edge case: adding ' (copy)' could cross the backup byte cap after initial import validation. `openProject` now repeats canonical export validation after all copy-name/ID changes, before any save, and reports errors inside the import dialog.
