import { useState, type FormEvent } from 'react';
import { type Project } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';
import { groupKeys, saveCustomKeys, UNGROUPED_KEY } from '../guidance';

export function KeysDialog({ project, close, saved }: { project: Project; close: () => void; saved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => groupKeys(project.id, project.boardGroups));
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const used = new Set([UNGROUPED_KEY]);
    const next: Record<string, string> = {};
    for (const g of project.boardGroups) {
      const k = (values[g.id] ?? '').trim().toLowerCase();
      if (!k) continue;
      if (!/^[a-z0-9]$/.test(k)) {
        setError(`Use one letter or number for ${g.title}.`);
        return;
      }
      if (used.has(k)) {
        setError(k === UNGROUPED_KEY ? '0 is kept for Ungrouped.' : `${k.toUpperCase()} is used twice.`);
        return;
      }
      used.add(k);
      next[g.id] = k;
    }
    saveCustomKeys(project.id, next);
    saved();
    close();
  }
  return (
    <Dialog
      title="Group keys"
      subtitle="Select words in a transcript, then press a key to file them. 0 is always Ungrouped. Keys are saved on this device."
      close={close}
    >
      <form onSubmit={submit}>
        <div className="key-fields">
          {project.boardGroups.map(g => (
            <Field key={g.id} label={g.title}>
              <input
                value={values[g.id] ?? ''}
                maxLength={1}
                autoComplete="off"
                onChange={e => setValues({ ...values, [g.id]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => {
              saveCustomKeys(project.id, {});
              saved();
              close();
            }}
          >
            Reset to 1–9
          </button>
          <button className="primary" type="submit">
            Save keys
          </button>
        </div>
      </form>
    </Dialog>
  );
}
