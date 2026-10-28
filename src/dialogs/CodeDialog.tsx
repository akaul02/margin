import { useState } from 'react';
import { Merge, Trash2 } from 'lucide-react';
import { type Code, type Project } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';
import { DraftStatus } from '../DraftRecovery';
import { useDurableDraft } from '../drafts';
import { plural } from '../format';

export function CodeDialog({
  code,
  project,
  close,
  submit,
  merge,
  remove,
  error,
}: {
  code: Code | 'new';
  project: Project;
  close: () => void;
  submit: (name: string, description: string, guidance: Pick<Code, 'inclusion' | 'exclusion' | 'exampleQuoteIds'>) => Promise<boolean>;
  merge: (into: string) => Promise<void>;
  remove: () => Promise<boolean>;
  error: string;
}) {
  const original = code === 'new' ? null : code;
  const draft = useDurableDraft(
    { projectId: project.id, kind: 'code', label: 'Unfinished code definition', entityId: original?.id, base: original },
    {
      name: original?.name ?? '',
      description: original?.description ?? '',
      inclusion: original?.inclusion ?? '',
      exclusion: original?.exclusion ?? '',
      exampleQuoteIds: original?.exampleQuoteIds ?? [],
    },
  );
  const { name, description, inclusion, exclusion, exampleQuoteIds } = draft.value;
  const setName = (name: string) => draft.update({ ...draft.value, name }),
    setDescription = (description: string) => draft.update({ ...draft.value, description }),
    setInclusion = (inclusion: string) => draft.update({ ...draft.value, inclusion }),
    setExclusion = (exclusion: string) => draft.update({ ...draft.value, exclusion }),
    setExamples = (fn: (ids: string[]) => string[]) => draft.update({ ...draft.value, exampleQuoteIds: fn(exampleQuoteIds) });
  const [into, setInto] = useState(''),
    [busy, setBusy] = useState(false);
  const dirty = draft.dirty;
  const closeDraft = () => {
    if (!busy && (!draft.error || window.confirm('This draft could not be stored. Close and lose the unsaved writing?'))) close();
  };

  return (
    <Dialog title={code === 'new' ? 'New code' : 'Edit code'} close={closeDraft}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          if (await submit(name, description, { inclusion, exclusion, exampleQuoteIds })) {
            if (draft.clear()) close();
          }
          setBusy(false);
        }}
      >
        <Field label="Code name">
          <input
            disabled={busy}
            autoFocus
            data-autofocus
            required
            maxLength={80}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your short label"
          />
        </Field>
        <Field label="What does this code mean to you? (optional)">
          <textarea
            disabled={busy}
            maxLength={20_000}
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Write your own definition or when to use this code."
          />
        </Field>
        <details className="code-guidance">
          <summary>Add guidance & examples (optional)</summary>
          <p className="small muted">Written by you. These notes can change as your reading develops.</p>
          <Field label="Include when">
            <textarea disabled={busy} rows={3} maxLength={20_000} value={inclusion} onChange={e => setInclusion(e.target.value)} />
          </Field>
          <Field label="Exclude when">
            <textarea disabled={busy} rows={3} maxLength={20_000} value={exclusion} onChange={e => setExclusion(e.target.value)} />
          </Field>
          {original && (
            <fieldset className="link-picker">
              <legend>Example quotes chosen by you</legend>
              <div className="quote-picker">
                {project.quotes
                  .filter(q => q.codeIds.includes(original.id))
                  .map(q => (
                    <label key={q.id}>
                      <input
                        disabled={busy}
                        type="checkbox"
                        checked={exampleQuoteIds.includes(q.id)}
                        onChange={() => setExamples(ids => (ids.includes(q.id) ? ids.filter(id => id !== q.id) : [...ids, q.id]))}
                      />
                      <span>
                        <small>{project.transcripts.find(t => t.id === q.transcriptId)!.name}</small>
                        <span>{q.text}</span>
                      </span>
                    </label>
                  ))}
              </div>
              {!project.quotes.some(q => q.codeIds.includes(original.id)) && (
                <p className="small muted">Code a passage with this label to choose it as an example.</p>
              )}
            </fieldset>
          )}
        </details>
        <DraftStatus draft={draft} />
        <ErrorBox error={error} />
        <div className="dialog-actions">
          {original && (
            <button
              type="button"
              className="text-button delete-link"
              disabled={busy}
              onClick={async () => {
                const n = project.quotes.filter(q => q.codeIds.includes(original.id)).length;
                if (
                  !window.confirm(
                    `Delete the code “${original.name}”? ${n ? `Its ${plural(n, 'quote')} stay, just without this label. ` : ''}Undo brings it back.`,
                  )
                )
                  return;
                setBusy(true);
                if (await remove()) {
                  draft.clear();
                  close();
                }
                setBusy(false);
              }}
            >
              <Trash2 size={15} />
              Delete code
            </button>
          )}
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button className="primary" disabled={busy} type="submit">
            {code === 'new' ? 'Create code' : 'Save changes'}
          </button>
        </div>
      </form>
      {code !== 'new' && project.codes.length > 1 && (
        <details className="merge-section">
          <summary>
            <Merge size={16} />
            Merge into another code
          </summary>
          <p className="small muted">Its quotes move to the code you pick, and this code goes away.</p>
          <Field label="Keep this code">
            <select value={into} onChange={e => setInto(e.target.value)}>
              <option value="">Choose a destination…</option>
              {project.codes
                .filter(c => c.id !== code.id)
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <button
            disabled={!into || busy}
            onClick={async () => {
              if (dirty && !window.confirm('Merge the saved code and discard unsaved edits in this dialog?')) return;
              setBusy(true);
              await merge(into);
              setBusy(false);
            }}
          >
            Merge “{code.name}”
          </button>
        </details>
      )}
    </Dialog>
  );
}
