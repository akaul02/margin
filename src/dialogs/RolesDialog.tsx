import { useState } from 'react';
import { type Project, type Role, type Transcript } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';
import { roles, roleLabel } from '../format';

export function RolesDialog({
  transcript,
  project,
  close,
  submit,
  error,
}: {
  transcript: Transcript;
  project: Project;
  close: () => void;
  submit: (roles: Record<string, Role>) => Promise<void>;
  error: string;
}) {
  const [values, setValues] = useState<Record<string, Role>>(Object.fromEntries(transcript.turns.map(t => [t.id, t.role])));
  return (
    <Dialog
      wide
      title="Review speaker roles"
      subtitle="Roles belong to individual turns. Coded participant turns are protected until their quotes are removed."
      close={close}
    >
      <div className="role-review">
        {transcript.turns.map((t, i) => (
          <div key={t.id}>
            <Field label={`Turn ${i + 1} · ${t.label}`}>
              <select
                value={values[t.id]}
                disabled={project.quotes.some(q => q.turnId === t.id)}
                onChange={e => setValues({ ...values, [t.id]: e.target.value as Role })}
              >
                {roles.map(r => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </Field>
            <p>{transcript.text.slice(t.start, t.end)}</p>
            {project.quotes.some(q => q.turnId === t.id) && (
              <small>Coded participant evidence · remove its quotes before changing this role.</small>
            )}
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="dialog-actions">
        <button onClick={close}>Cancel</button>
        <button className="primary" onClick={() => submit(values)}>
          Save roles
        </button>
      </div>
    </Dialog>
  );
}
