import { useWorkspaceServices } from './WorkspaceContext';
import { useEffect, useState } from 'react';
import { equal } from '../shared/operations.mjs';
import { draftArchive, readDraftRecovery, removeDraft, type Draft } from './drafts';
import { download, now, required, uid, type Project } from './model';
import { Dialog, ErrorBox } from './ui';
import type { Change } from './Workbench';

export function DraftStatus({ draft }: { draft: { saved: boolean; error: string; raw: () => string } }) {
  return (
    <>
      <p className="small muted" role="status">
        {draft.saved ? 'Writing draft saved on this device. Closing keeps it in Draft recovery.' : ''}
      </p>
      <ErrorBox error={draft.error} />
      {draft.error && (
        <button type="button" onClick={() => download('margin-unsaved-writing.json', draft.raw())}>
          Download this writing now
        </button>
      )}
    </>
  );
}

const fieldNames: Record<string, string> = {
  by: 'Writer',
  body: 'Your writing',
  title: 'Title',
  name: 'Code name',
  description: 'Definition',
  inclusion: 'Include when',
  exclusion: 'Exclude when',
  kind: 'Grouping type',
  color: 'Note color',
  quoteIds: 'Linked quotes',
  codeIds: 'Linked codes',
  exampleQuoteIds: 'Example quotes',
};
function displayField(key: string, value: unknown) {
  if (Array.isArray(value)) return `${value.length} saved links · included in the draft download`;
  if (key === 'color' && typeof value === 'number') return ['Butter', 'Sage', 'Rose', 'Blue', 'Lavender', 'Peach'][value] ?? String(value);
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function DraftRecovery({ project, change, workspaceError }: { project: Project; change: Change; workspaceError: string }) {
  const { namespace } = useWorkspaceServices();
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [damaged, setDamaged] = useState(0),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  function refresh() {
    try {
      const result = readDraftRecovery(project.id, namespace);
      setDrafts(result.drafts);
      setDamaged(result.damaged);
    } catch {
      setError('Draft storage could not be read. Saved project data is separate.');
    }
  }
  useEffect(() => {
    refresh();
    const listener = () => refresh();
    addEventListener('margin-drafts-changed', listener);
    addEventListener('storage', listener);
    return () => {
      removeEventListener('margin-drafts-changed', listener);
      removeEventListener('storage', listener);
    };
  }, [project.id]);
  async function restore(d: Draft, separate = false) {
    setBusy(true);
    setError('');
    setFailed(false);
    try {
      const ok = await change(p => {
        const date = now(),
          data = d.data;
        if (d.kind === 'note') {
          if (!d.entityId && !separate && p.comments.some(c => c.id === d.id))
            throw new Error('An earlier generation of this draft was already restored. Save this newer writing as a separate note.');
          if (!p.quotes.some(q => q.id === d.quoteId))
            throw new Error(
              'The source card was removed. Download this draft or keep it here; no quote will be invented or restored automatically.',
            );
          const existing = d.entityId ? p.comments.find(c => c.id === d.entityId) : undefined;
          if (d.entityId && !separate && (!existing || !equal(existing, d.base)))
            throw new Error(
              'This note changed or was removed after the draft began. Its current version is untouched. Save the recovered writing as a separate note instead.',
            );
          if (existing && !separate) {
            existing.by = required(data.by, 'Your name', 80);
            existing.body = data.body;
            existing.updatedAt = date;
          } else {
            required(data.body, 'Note', 20_000);
            p.comments.push({
              id: separate ? uid() : d.id,
              quoteId: d.quoteId!,
              by: required(data.by, 'Your name', 80),
              body: data.body,
              author: 'user',
              createdAt: date,
              updatedAt: date,
            });
          }
        } else if (d.kind === 'memo' || d.kind === 'comparison') {
          if (!d.entityId && !separate && p.memos.some(m => m.id === d.id))
            throw new Error('An earlier generation of this draft was already restored. Save this newer writing as a separate memo.');
          const existing = d.entityId ? p.memos.find(m => m.id === d.entityId) : undefined;
          if (d.entityId && !separate && (!existing || !equal(existing, d.base)))
            throw new Error('This memo changed after the draft began. Save this writing as a separate memo to keep both.');
          if (existing && !separate) {
            existing.title = required(data.title, 'Memo title');
            existing.body = data.body;
            existing.updatedAt = date;
          } else
            p.memos.push({
              id: separate ? uid() : d.id,
              title: required(data.title, 'Memo title'),
              body: data.body,
              quoteIds: (d.links ?? []).filter(id => p.quotes.some(q => q.id === id)),
              author: 'user',
              createdAt: date,
              updatedAt: date,
            });
        } else
          throw new Error(
            'Download this writing or copy it into its editor. Recovery does not automatically replace code or grouping definitions.',
          );
      }, 'Recovered your writing into the project.');
      if (ok) {
        removeDraft(d, namespace);
        refresh();
      } else setFailed(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {(drafts.length > 0 || damaged > 0 || error) && (
        <section className="draft-banner" aria-label="Draft recovery">
          <span>
            {drafts.length} saved writing {drafts.length === 1 ? 'draft' : 'drafts'} on this device.
            {damaged > 0 && ` ${damaged} damaged draft record(s) kept for download.`}
          </span>
          <button onClick={() => setOpen(true)}>Review saved drafts</button>
        </section>
      )}
      {open && (
        <Dialog
          wide
          title="Your saved writing drafts"
          subtitle="Recovered writing is separate from saved project notes and source quotations. Review before restoring."
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p>
            Drafts stay in this browser until saved or explicitly discarded. A device failure or clearing browser storage can still remove
            them. Download important writing.
          </p>
          <ErrorBox
            error={
              damaged
                ? `${damaged} draft record(s) could not be opened. Their original data is still here. Download all draft recovery data below; your readable drafts remain available.`
                : ''
            }
          />
          <ErrorBox error={error || (failed ? workspaceError || 'This recovery did not save. The draft is still here.' : '')} />
          {drafts.map(d => (
            <article className="recovery-draft" key={d.id}>
              <h3>{d.label}</h3>
              <small>
                {new Date(d.updatedAt).toLocaleString()} · {d.kind}
              </small>
              {Object.entries(d.data).map(([key, value]) => (
                <div key={key}>
                  <strong>{fieldNames[key] ?? key}</strong>
                  <pre>{displayField(key, value)}</pre>
                </div>
              ))}
              <div className="button-row wrap">
                <button onClick={() => download('margin-writing-draft.json', JSON.stringify(d, null, 2))}>Download this draft</button>
                {['note', 'memo', 'comparison'].includes(d.kind) && (
                  <>
                    <button disabled={busy} onClick={() => restore(d)}>
                      Restore saved writing
                    </button>
                    {(d.entityId || project.comments.some(c => c.id === d.id) || project.memos.some(m => m.id === d.id)) && (
                      <button disabled={busy} onClick={() => restore(d, true)}>
                        Save as a separate {d.kind === 'note' ? 'note' : 'memo'}
                      </button>
                    )}
                  </>
                )}
                <button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Discard this recovery draft? This cannot be undone.')) {
                      try {
                        removeDraft(d, namespace);
                        refresh();
                      } catch {
                        setError('The draft could not be removed.');
                      }
                    }
                  }}
                >
                  Discard draft
                </button>
              </div>
            </article>
          ))}
          {!drafts.length && <p>No saved writing drafts remain for this project.</p>}
          <div className="dialog-actions">
            <button
              onClick={() => {
                try {
                  download('margin-all-drafts.json', draftArchive(namespace));
                } catch {
                  setError('Draft storage is unavailable.');
                }
              }}
            >
              Download all draft recovery data
            </button>
            <button className="primary" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
