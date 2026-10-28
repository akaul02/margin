import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { newProject, type Project } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';

export function NewProjectDialog({ close, create, error }: { close: () => void; create: (p: Project) => Promise<boolean>; error: string }) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState('');
  return (
    <Dialog title="New project" subtitle="Transcripts, codes and notes are saved in this browser." close={close}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          try {
            await create(newProject(name));
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <Field label="Project name">
          <input
            autoFocus
            data-autofocus
            required
            maxLength={120}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Neighborhood experiences"
          />
        </Field>
        <ErrorBox error={localError || error} />
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create project
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
