# Astra max review and fixes · 2.1.1

2026-10-04 UTC / evening of 2026-10-03 America/New_York.

The user explicitly requested Astra at maximum reasoning before midnight. The review agent was launched with model **`gpt-6-astra`** and reasoning effort **`max`**, which the tool accepted. It performed a read-only audit of the actual 2.1.0 source and tests. Codex implemented the fixes and ran final verification. This was not a claim that all implementation used Astra or that credits were consumed to meet a quota.

## Confirmed findings and resolution

1. **Private room files exposed by the development server.** The API's origin restrictions did not protect Vite's separate static-file surface. Astra reproduced HTTP 200 responses containing a synthetic room and old notes/history through ordinary room paths, `/@fs`, `?raw` and `?import`, including a CORS header allowing another localhost origin. The reproduction used a temporary synthetic directory; actual room files were not inspected. Vite now blocks default and custom room locations before development or preview static handling, preserves the original sensitive-file deny rules, adds room filesystem denies, disables unnecessary CORS and disables the unused public directory.
2. **Accidental transcript dismissal.** Pasted/imported text could disappear when Escape, Close or Cancel dismissed the import dialog. The dialog now asks before abandoning unsaved source text. During file reading and final submission, controls are locked; closing is ignored until the operation finishes. A delayed shared save cannot discard subsequent edits made in the same editor.
3. **Damaged draft records could block healthy writing.** Codex found that draft records were accepted without validating their dates, labels or content types. Sorting could throw or rendering an object label could crash recovery. Draft records now undergo shape validation, malformed entries remain byte-for-byte in localStorage for download, and the recovery UI keeps healthy drafts usable beside a visible damage notice. Incomplete but valid writing and legacy draft keys remain supported.

## Independent verification

Astra reviewed the privacy patch and reported that the new 2/2 synthetic server checks passed. It additionally tried 28 synthetic requests using encoded paths, `/@fs`, `/@id`, default room directories and a custom room store inside `dist`; none returned the private marker or allowed cross-origin reading. The code and tests preserve the default sensitive-file deny patterns. No material easy bypass was found.

Astra traced operation acknowledgements, conditional commits, dependent queues, conflict preservation and scoped Undo. It reported no additional verified concurrency or provenance defect in that pass. That is a bounded review, not a proof that none exist.

New automated tests cover development/preview room-file denial, malformed draft isolation and raw downloads, incomplete/legacy draft compatibility, project scoping, transcript dismissal in both import stages, and controls during a delayed shared import. See [the final test record](../TEST-RESULTS.md) for the complete run.

## Deployment status

The user approved CLI deployment as an alternative to browser control. An already installed cached Vercel CLI **59.25.2** authenticated successfully through `whoami`, with telemetry disabled and noninteractive mode. Read-only queries found one Hobby team, three unrelated projects, no Margin project and no marketplace installations. No credentials were displayed or read directly; no login, OAuth, team/project changes, paid commitments, integrations or invites were performed.

Authenticated remote collaboration still requires a selected transactional database and authentication service. Proposed decision bundle: reuse an existing approved database/authentication service, or approve a separate Supabase Postgres + Auth setup for a new Margin Vercel project, including the account connection and credential configuration handoff. Supabase supports integrated Postgres authentication and row-level authorization ([Auth](https://supabase.com/docs/guides/auth), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)). No such service has been selected or provisioned. A lack of marketplace installations does not prove the user has no external database account.

The current app has no authenticated project membership and its backend requires a local Node process. No static-only upload was presented as working collaboration, and no hosted URL or live access-boundary verification is claimed. The sanitized source preparation excludes room files, browser data, transcripts outside explicit synthetic fixtures, backups and credentials. Existing local data and earlier deliveries remain intact.
