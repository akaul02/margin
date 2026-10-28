import { useState } from 'react';
import { ArrowDownToLine, Trash2 } from 'lucide-react';
import { download, exportProject, type Project } from '../model';
import { Dialog } from '../ui';
import { plural } from '../format';

export function DeleteProjectDialog({
  project,
  unshared,
  close,
  remove,
}: {
  project: Project;
  unshared: boolean;
  close: () => void;
  remove: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const file = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'project'}.margin.json`;
  return (
    <Dialog
      title={`Delete “${project.name}”?`}
      subtitle="This removes the project from this browser: its transcripts, quotes, board, codes, memos, card notes and restore points. It cannot be undone."
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="delete-summary">
        {plural(project.transcripts.length, 'transcript')} · {plural(project.quotes.length, 'quote')} ·{' '}
        {plural(project.memos.length, 'memo')}
      </p>
      {unshared && (
        <p className="error">This project has edits that were never shared with its local live session. Deleting it here loses them.</p>
      )}
      <p className="small muted">
        {saved ? `Backup downloaded as ${file}.` : 'A backup lets you open it again later with Open a project backup.'}
      </p>
      <div className="dialog-actions wrap">
        <button
          disabled={busy}
          onClick={() => {
            download(file, exportProject(project));
            setSaved(true);
          }}
        >
          <ArrowDownToLine size={16} />
          Download a backup first
        </button>
        <button disabled={busy} data-autofocus onClick={close}>
          Cancel
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await remove();
            setBusy(false);
            if (ok) close();
          }}
        >
          <Trash2 size={16} />
          Delete project
        </button>
      </div>
    </Dialog>
  );
}
