import { useState } from 'react';
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
  const duplicate = draft && workspace.projects.some(p => p.id === draft.id);
  return (
    <Dialog title="Open a project backup" subtitle="Restore a Margin .margin.json file. Existing projects are kept." close={close}>
      <Field label="Project backup file">
        <input
          type="file"
          accept=".json,application/json"
          onChange={async e => {
            const f = e.target.files?.[0];
            if (!f) return;
            setDraft(null);
            try {
              setDraft(importProject(await readTextFile(f, 16_000_000)));
              setLocalError('');
            } catch (e) {
              setLocalError((e as Error).message);
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
      <ErrorBox error={localError || error} />
      <div className="dialog-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!draft}
          onClick={() => {
            if (draft) {
              const p = copy(draft);
              if (duplicate) {
                p.id = uid();
                p.name = p.name.slice(0, 112) + ' (copy)';
              }
              submit(p);
            }
          }}
        >
          {duplicate ? 'Import separate copy' : 'Import project'}
        </button>
      </div>
    </Dialog>
  );
}
