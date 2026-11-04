# Saving and recovery

Margin already commits project changes automatically. A second manual-save mechanism would duplicate that work. The save strip now confirms **Saving project…**, **Project saved in this browser / on this computer**, or **Project save needs attention** after the storage transaction responds. This describes the saved project, not every open form and not cloud synchronization.

**Save backup** downloads the current project as lossless `.margin.json`. Open that backup in another browser or computer with **Open a project backup**. A backup contains committed project data; review and restore unfinished writing first if you want it included. Draft recovery also offers a separate raw-writing download.

| Situation | Local app with data file | Browser-only demo |
| --- | --- | --- |
| Refresh / browser closes after a confirmed save | Project reopens from SQLite | Project reopens from IndexedDB in the same browser and site |
| Crash during a project write | SQLite transaction commits or rolls back; a lost response can leave the outcome uncertain until reload | IndexedDB transaction commits or aborts; no partial project/history write |
| Browser site data cleared | Saved projects remain in the data file; reopen with the local key | Projects and history are removed |
| Another browser profile | Projects accessible with the local key on the same computer | Separate storage; import a backup |
| Another device or disk failure | No automatic transfer or protection from disk loss; use backups kept somewhere you trust | No automatic transfer; use backups |
| Two tabs edit the same workspace | Expected-revision check rejects the stale write | Expected-revision check rejects the stale write |

## Writing before Done / Save

Memo, card-note, code, group, theme, comparison, and now inline board-note editors store recoverable writing drafts in **this browser's localStorage**. Drafts use separate generation keys, so recovering one generation does not remove later typing. Drafts are not in SQLite, not synchronized between browsers or devices, and are removed by browser-data clearing. Storage denial or quota failure leaves the current text visible and offers a download; save it or copy it before closing.

Inline board notes were the actual autosave gap: they previously lived only in React state until blur, Enter, or Done. They now write a recovery draft on each change. Done/Enter/blur commits the note; Escape explicitly discards that draft. Saving clears only the submitted generation. Recovery checks the original note before replacing it and offers a separate note when the original changed or disappeared. The stable draft ID prevents a duplicate ordinary recovery after a successful save whose response was lost.

Unsubmitted transcript import/review forms, rename dialogs, and new-project forms still keep their input in memory. Transcript imports warn before normal navigation; rename and new-project names do not have durable recovery. A crash can lose that unfinished input. Finish the import before relying on project autosave; the original selected file remains on disk. This change does not claim those forms are durable drafts.

## Failure handling

- IndexedDB project updates, revision checks, restore points, and migration archives are one transaction. SQLite uses a transaction, WAL, and synchronous FULL.
- A stale tab is stopped instead of overwriting another tab's project. Keep its draft, reload, and review recovery. There is no automatic general-purpose merge.
- If the local server commits but its response is lost, the app reports that the request could not be confirmed. Reload checks the actual saved state; it never promises that nothing changed in that case.
- Storage persistence requests are best effort. Browser eviction, deliberate clearing, device loss, and failure before an input event completes still require external backups.
- History retains up to 20 project restore points. It is stored with the project and is not a separate disaster-recovery backup.

The existing optional sharing and hosted modes are unchanged. No accounts, cloud service, telemetry, new network access, or synchronization were added.
