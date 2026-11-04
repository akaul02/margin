import { useEffect, useRef, useState } from 'react';
import { copy, importProject, readTextFile, uid, type Project, type Workspace } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';

export function RestoreDialog({
  workspace,
  close,
  submit,
  error,
}: {
  workspace: Workspace;
  close: () => void;
  submit: (p: Project) => Promise<boolean>;
  error: string;
}) {
  const [draft, setDraft] = useState<Project | null>(null);
  const [localError, setLocalError] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const readVersion = useRef(0);
  const submitting = useRef(false);
  useEffect(
    () => () => {
      readVersion.current++;
    },
    [],
  );
  const closeDialog = () => {
    if (!submitting.current) close();
  };
  const duplicate = draft && workspace.projects.some(p => p.id === draft.id);
  return (
    <Dialog title="Open a project backup" subtitle="Restore a Margin .margin.json file. Existing projects are kept." close={closeDialog}>
      <Field label="Project backup file">
        <input
          type="file"
          accept=".json,application/json"
          disabled={saving}
          onChange={async e => {
            if (submitting.current) return;
            const f = e.target.files?.[0];
            const version = ++readVersion.current;
            setDraft(null);
            setLocalError('');
            setReading(!!f);
            if (!f) return;
            try {
              const project = importProject(await readTextFile(f, 16_000_000));
              if (version === readVersion.current) setDraft(project);
            } catch (e) {
              if (version === readVersion.current) setLocalError((e as Error).message);
            } finally {
              if (version === readVersion.current) setReading(false);
            }
          }}
        />
      </Field>
      {draft && (
        <div className="restore-preview">
          <h3>{draft.name}</h3>
          <p>
            {draft.transcripts.length} transcripts · {draft.codes.length} codes · {draft.quotes.length} quotes · {draft.memos.length} memos
          </p>
          {duplicate && (
            <p>
              This project already exists here. Importing a separate copy keeps both versions. Internal source and quote references are
              preserved.
            </p>
          )}
        </div>
      )}
      {(reading || saving) && (
        <p role="status" className="small muted">
          {reading ? 'Reading your backup…' : 'Saving your project…'}
        </p>
      )}
      <ErrorBox error={localError || error} />
      <div className="dialog-actions">
        <button disabled={saving} onClick={closeDialog}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!draft || reading || saving}
          onClick={async () => {
            if (draft && !submitting.current) {
              submitting.current = true;
              setSaving(true);
              setLocalError('');
              const p = copy(draft);
              if (duplicate) {
                p.id = uid();
                p.name = p.name.slice(0, 112) + ' (copy)';
              }
              try {
                await submit(p);
              } catch (e) {
                setLocalError((e as Error).message);
              } finally {
                submitting.current = false;
                setSaving(false);
              }
            }
          }}
        >
          {duplicate ? 'Import separate copy' : 'Import project'}
        </button>
      </div>
    </Dialog>
  );
}
