import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { download, type Memo, type Project, type Quote } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';
import { Evidence } from '../Workbench';
import { useDurableDraft } from '../drafts';

export function MemoDialog({
  memo,
  project,
  jump,
  close,
  submit,
  remove,
  error,
}: {
  project: Project;
  jump: (q: Quote) => void;
  memo: Memo | 'new';
  close: () => void;
  submit: (title: string, body: string) => Promise<boolean>;
  remove?: () => Promise<boolean>;
  error: string;
}) {
  const original = memo === 'new' ? null : memo;
  const draft = useDurableDraft(
    {
      projectId: project.id,
      kind: 'memo',
      label: original ? 'Unfinished memo edit' : 'Unfinished memo',
      entityId: original?.id,
      base: original,
      links: original?.quoteIds,
    },
    { title: original?.title ?? '', body: original?.body ?? '' },
  );
  const { title, body } = draft.value;
  const [busy, setBusy] = useState(false);
  const setTitle = (title: string) => draft.update({ ...draft.value, title }),
    setBody = (body: string) => draft.update({ ...draft.value, body });
  const dirty = draft.dirty;
  const closeDraft = () => {
    if (
      !busy &&
      (!dirty ||
        window.confirm(
          draft.error
            ? 'This memo draft could not be stored. Download or copy it first. Close and lose the unsaved writing?'
            : 'Close this memo? Your stored draft stays in Draft recovery. Choose Cancel to keep writing.',
        ))
    )
      close();
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  return (
    <Dialog wide title={memo === 'new' ? 'Write a memo' : 'Memo'} close={closeDraft}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          const submitted = { title, body };
          setBusy(true);
          try {
            if (await submit(title, body)) {
              if (draft.clear(submitted)) close();
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Memo title">
          <input
            disabled={busy}
            autoFocus
            data-autofocus
            maxLength={120}
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="A question or thought to return to"
          />
        </Field>
        <Field label="Your words">
          <textarea
            disabled={busy}
            rows={10}
            maxLength={100_000}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write what you are noticing, wondering, or deciding…"
          />
        </Field>
        {memo !== 'new' && !!memo.quoteIds.length && (
          <details>
            <summary>{memo.quoteIds.length} linked participant quotes</summary>
            {memo.quoteIds.map(id => (
              <Evidence
                key={id}
                quote={project.quotes.find(q => q.id === id)!}
                project={project}
                jump={q => {
                  if (!dirty || window.confirm('Discard unsaved memo changes and view this source?')) {
                    close();
                    jump(q);
                  }
                }}
              />
            ))}
          </details>
        )}
        <p className="small muted" role="status">
          {draft.saved ? 'Writing draft saved on this device.' : 'Your memo is saved when you choose Save memo.'}
        </p>
        <ErrorBox error={draft.error || error} />
        {draft.error && (
          <button type="button" onClick={() => download('margin-unsaved-memo.json', draft.raw())}>
            Download this writing now
          </button>
        )}
        <div className="dialog-actions">
          {original && remove && (
            <button
              type="button"
              className="text-button delete-link"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Delete the memo “${original.title}”? Undo brings it back.`)) return;
                setBusy(true);
                if (await remove()) {
                  draft.clear();
                  close();
                }
                setBusy(false);
              }}
            >
              <Trash2 size={15} />
              Delete memo
            </button>
          )}
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className="primary">
            Save memo
          </button>
        </div>
      </form>
    </Dialog>
  );
}
