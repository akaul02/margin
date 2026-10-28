import { useState } from 'react';
import { ErrorBox, Dialog, Field } from '../ui';

export function RenameDialog({
  kind,
  name,
  close,
  submit,
  error,
}: {
  kind: 'project' | 'transcript';
  name: string;
  close: () => void;
  submit: (name: string) => Promise<boolean>;
  error: string;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={kind === 'project' ? 'Rename project' : 'Rename transcript'} close={close}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          await submit(value);
          setBusy(false);
        }}
      >
        <Field label="Name">
          <input data-autofocus required maxLength={120} value={value} onChange={e => setValue(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !value.trim() || value.trim() === name}>
            Save name
          </button>
        </div>
      </form>
    </Dialog>
  );
}
