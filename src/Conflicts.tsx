import { useState } from 'react';
import { recordAt } from '../shared/operations.mjs';
import { download, type Project, type SharedConnection } from './model';
import { Dialog, ErrorBox } from './ui';

function words(value: any) {
  if (value === null) return 'Removed / absent';
  if (typeof value !== 'object') return String(value);
  return (
    [value.by, value.title ?? value.name, value.body ?? value.description ?? value.text].filter(Boolean).join('\n\n') ||
    JSON.stringify(value, null, 2)
  );
}
export function ConflictDialog({
  project,
  connection,
  close,
  resolve,
}: {
  project: Project;
  connection: SharedConnection;
  close: () => void;
  resolve: (separate: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const conflict = connection.conflict!,
    operation = connection.pending?.find(op => op.id === conflict.operationId);
  const noteChanges = operation?.changes.filter(c => c.collection === 'comments' && c.after) ?? [];
  const noteChange = noteChanges.length === 1 ? noteChanges[0] : undefined;
  const note = project.comments.find(c => c.id === noteChange?.id);
  const canAppend = note && conflict.remote.quotes.some(q => q.id === note.quoteId);
  async function finish(separate: boolean) {
    setBusy(true);
    setError('');
    try {
      await resolve(separate);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      wide
      title="Two versions to consider"
      subtitle="Your writing is kept here. The other version is on the shared board. Nothing was merged automatically."
      close={() => {
        if (!busy) close();
      }}
    >
      <p>
        These are the versions when this conflict was detected. Resolution checks the shared board again. Every choice below keeps{' '}
        <strong>all your local work in a separate project</strong>, including any later pending edits.
      </p>
      {operation?.changes.map(c => (
        <section className="conflict-record" key={`${c.collection}:${c.id}`}>
          <h3>
            {c.collection === 'comments' ? 'Card note' : c.collection === 'quotes' ? 'Quote card' : c.collection}{' '}
            <small>{c.id.slice(0, 8)}</small>
          </h3>
          <div className="conflict-versions">
            <div>
              <h4>Your local version</h4>
              <pre>{words(recordAt(project, c))}</pre>
            </div>
            <div>
              <h4>Shared version at conflict</h4>
              <pre>{words(recordAt(conflict.remote, c))}</pre>
            </div>
          </div>
        </section>
      ))}
      {!operation && (
        <p>This older pending save has no record history. Keep the separate local copy to compare it with the shared project.</p>
      )}
      {conflict.reason === 'references_changed' && (
        <p>
          Together these versions would create a duplicate name or a broken link. The whole edit was stopped so related writing stays
          intact.
        </p>
      )}
      {note && !canAppend && (
        <p>The quote is no longer on the shared board. Your separate project will keep the exact source quote and this note together.</p>
      )}
      <ErrorBox error={error} />
      <div className="dialog-actions wrap">
        <button
          disabled={busy}
          onClick={() =>
            download('margin-pending-edits.json', JSON.stringify({ projectId: project.id, pending: connection.pending, conflict }, null, 2))
          }
        >
          Download pending versions
        </button>
        <button disabled={busy} onClick={() => finish(false)}>
          Keep local copy & use shared
        </button>
        {canAppend && (
          <button className="primary" disabled={busy} onClick={() => finish(true)}>
            Add my version as a separate note
          </button>
        )}
      </div>
    </Dialog>
  );
}
