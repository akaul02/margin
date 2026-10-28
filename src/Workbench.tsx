import { useWorkspaceServices } from './WorkspaceContext';
import { useEffect, useState } from 'react';
import { useDurableDraft } from './drafts';
import { DraftStatus } from './DraftRecovery';
import { equal } from '../shared/operations.mjs';
import { ArrowDownToLine, ArrowRight, BookOpen, Columns2, GitBranch, History, Plus, Quote as QuoteIcon, Table2 } from 'lucide-react';
import { CodeDot, Dialog, Empty, ErrorBox, Field } from './ui';
import {
  turnRoleLabel,
  copy,
  coverageCSV,
  coverageRows,
  download,
  exportProject,
  now,
  required,
  uid,
  type Code,
  type Project,
  type Quote,
  type ThemeGroup,
} from './model';
import { type HistoryResult, type RestorePoint } from './storage';
export type Change = (mutator: (p: Project) => void, message: string) => Promise<boolean>;
type Panel = 'codebook' | 'compare' | 'themes' | 'coverage' | 'history';
const panels = [
  { id: 'codebook', title: 'Codebook', icon: BookOpen },
  { id: 'themes', title: 'Themes', icon: GitBranch },
  { id: 'coverage', title: 'Coding map', icon: Table2 },
  { id: 'compare', title: 'Compare', icon: Columns2 },
] as const;
export function useDraftGuard(dirty: boolean, close: () => void) {
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
  return () => {
    if (!dirty || window.confirm('Discard your unsaved writing?')) close();
  };
}
export function Evidence({
  quote: q,
  project: p,
  jump,
  expanded = false,
}: {
  quote: Quote;
  project: Project;
  jump: (q: Quote) => void;
  expanded?: boolean;
}) {
  if (!q) return <p className="method-note">This linked quote is no longer in the current project. Your writing is unchanged.</p>;
  const t = p.transcripts.find(x => x.id === q.transcriptId);
  if (!t) return <p className="method-note">The linked source is no longer in the current project.</p>;
  const i = t.turns.findIndex(x => x.id === q.turnId);
  if (i < 0) return <p className="method-note">The linked source turn is no longer available.</p>;
  return (
    <article className="evidence">
      <div className="quote-source">
        <span>{t.name}</span>
        <span>
          Turn {i + 1} · {t.turns[i].label}
        </span>
      </div>
      <blockquote>{q.text}</blockquote>
      <div className="quote-codes">
        {q.codeIds.map(id => {
          const c = p.codes.find(x => x.id === id)!;
          return (
            <span className={`code-tag color-${c.color}`} key={id}>
              {c.name}
            </span>
          );
        })}
      </div>
      <details className="quote-context" open={expanded}>
        <summary>Show context</summary>
        {[i - 1, i, i + 1]
          .filter(n => t.turns[n])
          .map(n => {
            const turn = t.turns[n];
            return (
              <div key={turn.id} className={n === i ? 'current-context' : ''}>
                <strong>
                  {turn.label} · {turnRoleLabel(turn)}
                </strong>
                <p>{t.text.slice(turn.start, turn.end)}</p>
              </div>
            );
          })}
      </details>
      <button type="button" className="text-button" onClick={() => jump(q)}>
        View in transcript
        <ArrowRight size={15} />
      </button>
    </article>
  );
}
export function Workbench({
  project: p,
  change,
  editCode,
  jump,
}: {
  project: Project;
  change: Change;
  editCode: (code: Code | 'new') => void;
  jump: (q: Quote) => void;
}) {
  const [panel, setPanel] = useState<Panel>('codebook');
  const [group, setGroup] = useState<ThemeGroup | 'new' | null>(null);
  return (
    <section className="workbench">
      <div className="page-heading">
        <div>
          <h1>Codes & themes</h1>
        </div>
      </div>
      <nav className="bench-nav" aria-label="Workbench tools">
        {panels.map(({ id, title, icon: Icon }) => (
          <button
            key={id}
            className={panel === id ? 'active' : ''}
            aria-current={panel === id ? 'page' : undefined}
            onClick={() => setPanel(id)}
          >
            <Icon size={17} />
            {title}
          </button>
        ))}
      </nav>
      {panel === 'codebook' && (
        <>
          <div className="bench-heading">
            <div>
              <h2>Codes</h2>
            </div>
            <button onClick={() => editCode('new')}>
              <Plus size={16} />
              New code
            </button>
          </div>
          <div className="definition-grid">
            {p.codes.map(c => (
              <article className="definition-card" key={c.id}>
                <div className="definition-title">
                  <CodeDot color={c.color} />
                  <h3>{c.name}</h3>
                  <button className="text-button" onClick={() => editCode(c)} aria-label={`Define ${c.name}`}>
                    Edit
                    <ArrowRight size={15} />
                  </button>
                </div>
                {c.description && <p className="clamp">{c.description}</p>}
                {(c.inclusion || c.exclusion) && (
                  <dl>
                    {c.inclusion && (
                      <div>
                        <dt>Include when</dt>
                        <dd>{c.inclusion}</dd>
                      </div>
                    )}
                    {c.exclusion && (
                      <div>
                        <dt>Exclude when</dt>
                        <dd>{c.exclusion}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {!!c.exampleQuoteIds.length && (
                  <details>
                    <summary>
                      {c.exampleQuoteIds.length} example{c.exampleQuoteIds.length === 1 ? '' : 's'}
                    </summary>
                    {c.exampleQuoteIds.map(id => (
                      <Evidence key={id} quote={p.quotes.find(q => q.id === id)!} project={p} jump={jump} />
                    ))}
                  </details>
                )}
                <small>{p.quotes.filter(q => q.codeIds.includes(c.id)).length} quotes</small>
              </article>
            ))}
          </div>
          {!p.codes.length && (
            <Empty title="No codes yet" icon={<BookOpen />}>
              <p>Codes are short labels for quotes. Add one here or while reading a transcript.</p>
            </Empty>
          )}
        </>
      )}
      {panel === 'compare' && <Comparison project={p} change={change} jump={jump} />}
      {panel === 'themes' && (
        <>
          <div className="bench-heading">
            <div>
              <h2>Themes</h2>
            </div>
            <button className="primary" onClick={() => setGroup('new')}>
              <Plus size={16} />
              New grouping
            </button>
          </div>
          <div className="theme-grid">
            {p.themes.map(g => (
              <article className="theme-card" key={g.id}>
                <span className="eyebrow">{g.kind === 'theme' ? 'Theme' : 'Code group'}</span>
                <h3>{g.title}</h3>
                {g.body && <p className="preserve-text clamp">{g.body}</p>}
                <div className="quote-codes">
                  {g.codeIds.map(id => {
                    const c = p.codes.find(c => c.id === id)!;
                    return (
                      <span key={id} className={`code-tag color-${c.color}`}>
                        {c.name}
                      </span>
                    );
                  })}
                </div>
                <details>
                  <summary>{g.quoteIds.length} linked quotes</summary>
                  {g.quoteIds.map(id => (
                    <Evidence key={id} quote={p.quotes.find(q => q.id === id)!} project={p} jump={jump} />
                  ))}
                  {!g.quoteIds.length && <p className="small muted">No passages linked yet.</p>}
                </details>
                <button onClick={() => setGroup(g)}>
                  Edit grouping
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
          {!p.themes.length && (
            <Empty title="No themes yet" icon={<GitBranch />}>
              <p>A theme ties codes and quotes together under one idea.</p>
            </Empty>
          )}
        </>
      )}
      {panel === 'coverage' && <Coverage project={p} jump={jump} />}
      {group && <GroupEditor project={p} group={group} change={change} close={() => setGroup(null)} />}
    </section>
  );
}
function Comparison({ project: p, change, jump }: { project: Project; change: Change; jump: (q: Quote) => void }) {
  const [left, setLeft] = useState(p.quotes[0]?.id ?? '');
  const [right, setRight] = useState(p.quotes[1]?.id ?? '');
  const [writing, setWriting] = useState(false);
  const a = p.quotes.find(q => q.id === left),
    b = p.quotes.find(q => q.id === right);
  return (
    <>
      <div className="bench-heading">
        <div>
          <h2>Compare quotes</h2>
          <p>Notice similarities, differences, or something that complicates your first reading.</p>
        </div>
        <button className="primary" disabled={!a || !b || a.id === b.id} onClick={() => setWriting(true)}>
          Write comparison memo
        </button>
      </div>
      <div className="comparison-grid">
        {[
          { side: 'First', value: left, set: setLeft, q: a },
          { side: 'Second', value: right, set: setRight, q: b },
        ].map(({ side, value, set, q }) => (
          <section className="comparison-column" key={side}>
            <Field label={`${side} quote`}>
              <select value={value} onChange={e => set(e.target.value)}>
                <option value="">Choose a coded passage</option>
                {p.quotes.map((q, i) => (
                  <option value={q.id} key={q.id}>
                    {i + 1}. {p.transcripts.find(t => t.id === q.transcriptId)!.name} — {q.text.slice(0, 80)}
                  </option>
                ))}
              </select>
            </Field>
            {q ? (
              <Evidence quote={q} project={p} jump={jump} expanded />
            ) : (
              <div className="comparison-empty">
                <QuoteIcon size={26} />
                <p>Choose exact words to keep in view.</p>
              </div>
            )}
          </section>
        ))}
      </div>
      {a && b && a.id === b.id && <p className="method-note">Choose two different quotes to write a comparison memo.</p>}
      <p className="small muted">
        A comparison is a prompt for your thinking. It does not establish a finding. Saved notes appear in Your memos with links to both
        passages.
      </p>
      {writing && a && b && <ComparisonEditor projectId={p.id} quoteIds={[a.id, b.id]} change={change} close={() => setWriting(false)} />}
    </>
  );
}
function ComparisonEditor({
  projectId,
  quoteIds,
  change,
  close,
}: {
  projectId: string;
  quoteIds: string[];
  change: Change;
  close: () => void;
}) {
  const draft = useDurableDraft(
    { projectId, kind: 'comparison', label: 'Unfinished comparison memo', links: quoteIds },
    { title: '', body: '' },
  );
  const { title, body } = draft.value;
  const setTitle = (title: string) => draft.update({ ...draft.value, title }),
    setBody = (body: string) => draft.update({ ...draft.value, body });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const closeDraft = () => {
    if (!busy && (!draft.error || window.confirm('This draft could not be stored. Close and lose the unsaved writing?'))) close();
  };

  return (
    <Dialog title="Your comparison memo" subtitle="Your interpretation, linked to two exact participant quotes." close={closeDraft}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          if (!title.trim()) {
            setError('Add a memo title before saving.');
            return;
          }
          setBusy(true);
          try {
            const ok = await change(p => {
              const date = now();
              p.memos.push({
                id: uid(),
                title: required(title, 'Memo title'),
                body,
                author: 'user',
                quoteIds,
                createdAt: date,
                updatedAt: date,
              });
            }, 'Comparison memo saved with both quote links.');
            if (ok) {
              if (draft.clear()) close();
            } else setError('The memo was not saved. Your draft is still here; see the workspace message.');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Memo title">
          <input disabled={busy} required maxLength={120} data-autofocus value={title} onChange={e => setTitle(e.target.value)} />
        </Field>
        <Field label="Your comparison">
          <textarea
            disabled={busy}
            rows={8}
            maxLength={100_000}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="What do you notice when you read these passages together? What might you need to revisit?"
          />
        </Field>
        <DraftStatus draft={draft} />
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save comparison memo
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function GroupEditor({
  project: p,
  group,
  change,
  close,
}: {
  project: Project;
  group: ThemeGroup | 'new';
  change: Change;
  close: () => void;
}) {
  const original = group === 'new' ? null : group;
  const draft = useDurableDraft(
    { projectId: p.id, kind: 'theme', label: 'Unfinished grouping or working theme', entityId: original?.id, base: original },
    {
      title: original?.title ?? '',
      body: original?.body ?? '',
      kind: original?.kind ?? 'group',
      codeIds: original?.codeIds ?? [],
      quoteIds: original?.quoteIds ?? [],
    },
  );
  const { title, body, kind, codeIds, quoteIds } = draft.value;
  const setTitle = (title: string) => draft.update({ ...draft.value, title }),
    setBody = (body: string) => draft.update({ ...draft.value, body }),
    setKind = (kind: ThemeGroup['kind']) => draft.update({ ...draft.value, kind }),
    setCodeIds = (codeIds: string[]) => draft.update({ ...draft.value, codeIds }),
    setQuoteIds = (quoteIds: string[]) => draft.update({ ...draft.value, quoteIds });
  const [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const closeDraft = () => {
    if (!busy && (!draft.error || window.confirm('This draft could not be stored. Close and lose the unsaved writing?'))) close();
  };
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  return (
    <Dialog
      wide
      title={original ? 'Edit your grouping' : 'Make a connection'}
      subtitle="A grouping or working theme is written and assembled by you."
      close={closeDraft}
    >
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          if (!title.trim()) {
            setError('Add a grouping title before saving.');
            return;
          }
          setBusy(true);
          try {
            const ok = await change(next => {
              if (
                original &&
                !equal(
                  next.themes.find(g => g.id === original.id),
                  original,
                )
              )
                throw new Error('This grouping changed or was removed. Your draft is kept for review.');
              const date = now();
              const value = {
                id: original?.id ?? uid(),
                title: required(title, 'Grouping title'),
                body,
                kind,
                author: 'user' as const,
                codeIds,
                quoteIds,
                createdAt: original?.createdAt ?? date,
                updatedAt: date,
              };
              if (original) next.themes = next.themes.map(g => (g.id === original.id ? value : g));
              else next.themes.push(value);
            }, 'Your grouping and evidence links were saved.');
            if (ok) {
              if (draft.clear()) close();
            } else setError('This grouping was not saved. Your draft is still here; see the workspace message.');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Grouping title">
          <input disabled={busy} required maxLength={120} data-autofocus value={title} onChange={e => setTitle(e.target.value)} />
        </Field>
        <Field label="How are you using this?">
          <select disabled={busy} value={kind} onChange={e => setKind(e.target.value as ThemeGroup['kind'])}>
            <option value="group">Code group · organize labels</option>
            <option value="theme">Working theme · explore an interpretation</option>
          </select>
        </Field>
        <Field label="Your working note">
          <textarea
            disabled={busy}
            rows={5}
            maxLength={100_000}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="What connects these passages? What does not fit? What question does this help you explore?"
          />
        </Field>
        <fieldset className="link-picker">
          <legend>Codes you want to connect</legend>
          {p.codes.map(c => (
            <label key={c.id} className="code-check">
              <input disabled={busy} type="checkbox" checked={codeIds.includes(c.id)} onChange={() => setCodeIds(toggle(codeIds, c.id))} />
              <CodeDot color={c.color} />
              {c.name}
            </label>
          ))}
          {!p.codes.length && <p>Create a code first to link it here.</p>}
        </fieldset>
        <fieldset className="link-picker">
          <legend>Exact quote links · choose these yourself</legend>
          <input
            disabled={busy}
            type="search"
            aria-label="Find quotes to link"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find words in your coded quotes"
          />
          <div className="quote-picker">
            {p.quotes
              .filter(q => q.text.toLowerCase().includes(search.toLowerCase()))
              .map(q => (
                <label key={q.id}>
                  <input
                    disabled={busy}
                    type="checkbox"
                    checked={quoteIds.includes(q.id)}
                    onChange={() => setQuoteIds(toggle(quoteIds, q.id))}
                  />
                  <span>
                    <small>{p.transcripts.find(t => t.id === q.transcriptId)!.name}</small>
                    <span>{q.text}</span>
                  </span>
                </label>
              ))}
          </div>
          <small>{quoteIds.length} selected. Include contrasting passages if they help your thinking.</small>
        </fieldset>
        <DraftStatus draft={draft} />
        <ErrorBox error={error} />
        <div className="dialog-actions wrap">
          {original && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm('Remove this grouping? Its codes, quotes and memos will remain. A restore point will keep this version.')
                )
                  return;
                setBusy(true);
                if (
                  await change(next => {
                    if (
                      !equal(
                        next.themes.find(g => g.id === original.id),
                        original,
                      )
                    )
                      throw new Error('This grouping changed. Review it before removing it.');
                    next.themes = next.themes.filter(g => g.id !== original.id);
                  }, 'Grouping removed. Its sources remain available.')
                )
                  close();
                setBusy(false);
              }}
            >
              Remove grouping
            </button>
          )}
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save grouping
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function Coverage({ project: p, jump }: { project: Project; jump: (q: Quote) => void }) {
  const [cell, setCell] = useState<{ transcriptId: string; speaker: string; codeId: string } | null>(null);
  const rows = coverageRows(p);
  const quotes = cell
    ? p.quotes.filter(
        q =>
          q.transcriptId === cell.transcriptId &&
          q.codeIds.includes(cell.codeId) &&
          p.transcripts.find(t => t.id === q.transcriptId)!.turns.find(t => t.id === q.turnId)!.label === cell.speaker,
      )
    : [];
  return (
    <>
      <div className="bench-heading">
        <div>
          <h2>Coding map</h2>
          <p>A descriptive view of your coding activity. Select a count to inspect its quotes.</p>
        </div>
        <button onClick={() => download('margin-coding-map.csv', coverageCSV(p), 'text/csv;charset=utf-8')}>
          <ArrowDownToLine size={16} />
          Export map
        </button>
      </div>
      <div className="method-note">
        <strong>Counts are not importance or representativeness.</strong> Each cell counts distinct coded passages, including overlaps. A
        zero means no saved quote with that code; it does not show absence of an experience. Speaker labels are grouped by their exact text
        only within each source. No identity is inferred across sources.
      </div>
      {p.codes.length && rows.length ? (
        <div className="matrix-scroll" role="region" aria-label="Coding map, scroll horizontally for more codes" tabIndex={0}>
          <table className="coding-matrix">
            <caption>Coded quote counts by source and participant label</caption>
            <thead>
              <tr>
                <th scope="col">Source / speaker label</th>
                {p.codes.map(c => (
                  <th scope="col" key={c.id}>
                    <CodeDot color={c.color} />
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.transcriptId}:${r.speaker}`}>
                  <th scope="row">
                    {r.transcript}
                    <small>{r.speaker}</small>
                  </th>
                  {p.codes.map(c => (
                    <td key={c.id}>
                      <button
                        className={r.counts[c.id] ? 'has-quotes' : ''}
                        aria-label={`${r.transcript}, ${r.speaker}, ${c.name}: ${r.counts[c.id]} quotes`}
                        onClick={() => setCell({ transcriptId: r.transcriptId, speaker: r.speaker, codeId: c.id })}
                      >
                        {r.counts[c.id]}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No history yet" icon={<Table2 />}>
          <p>Add participant sources and codes to explore your coding activity.</p>
        </Empty>
      )}
      {cell && (
        <Dialog
          wide
          title={`${p.codes.find(c => c.id === cell.codeId)?.name} · ${cell.speaker}`}
          subtitle={`${quotes.length} exact coded passages in this source`}
          close={() => setCell(null)}
        >
          {quotes.map(q => (
            <Evidence
              key={q.id}
              quote={q}
              project={p}
              jump={q => {
                setCell(null);
                jump(q);
              }}
            />
          ))}
          {!quotes.length && <p>No saved quotes carry this code for this speaker label in this source.</p>}
        </Dialog>
      )}
    </>
  );
}
export function HistoryPanel({
  project: p,
  change,
  revision,
  restored,
}: {
  project: Project;
  change: Change;
  revision: string;
  restored?: () => void;
}) {
  const [history, setHistory] = useState<HistoryResult | null>(null),
    [error, setError] = useState(''),
    [chosen, setChosen] = useState<RestorePoint | null>(null),
    [busy, setBusy] = useState(false);
  const { loadHistory, rawHistory } = useWorkspaceServices().storage;
  useEffect(() => {
    let active = true;
    loadHistory(p.id)
      .then(h => {
        if (active) setHistory(h);
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [p.id, revision]);
  return (
    <>
      <div className="bench-heading">
        <div>
          <h2>Restore points</h2>
          <p>Restore points are saved automatically before project edits, including restorations.</p>
        </div>
      </div>
      <div className="method-note">
        The latest 20 restore points are kept on this device, within a 20 MB limit per project. Older points are pruned as you work. Project
        exports include your current work; restore points stay on this computer. Keep separate backups for long-term records.
      </div>
      <ErrorBox error={error} />
      {!history && !error && <p role="status">Reading restore points…</p>}
      {history?.migration != null && (
        <div className="migration-backup">
          <strong>Your original pre-upgrade project is preserved.</strong>
          <p>Download the exact project from before the upgrade. It is kept separately from the rolling restore points.</p>
          <button onClick={() => download('margin-before-upgrade.margin.json', JSON.stringify(history.migration, null, 2))}>
            <ArrowDownToLine size={16} />
            Download pre-upgrade backup
          </button>
        </div>
      )}
      {history?.intermediate != null && (
        <button onClick={() => download('margin-before-board-upgrade.margin.json', JSON.stringify(history.intermediate, null, 2))}>
          <ArrowDownToLine size={16} />
          Download previous v2 backup
        </button>
      )}
      {history?.corrupt && (
        <div className="error">
          Some restore data could not be read. Its raw data is preserved.{' '}
          <button
            onClick={async () => {
              try {
                download('margin-history-recovery.json', await rawHistory(p.id));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Download history recovery
          </button>
        </div>
      )}
      <ol className="history-list">
        {history?.points
          .slice()
          .reverse()
          .map(point => (
            <li key={point.id}>
              <div className="history-dot" />
              <div>
                <strong>Before: {point.label}</strong>
                <small>
                  {new Date(point.createdAt).toLocaleString()} · {point.project.quotes.length} quotes · {point.project.codes.length} codes ·{' '}
                  {point.project.themes.length} groups
                </small>
              </div>
              <button onClick={() => setChosen(point)}>
                Review restore
                <ArrowRight size={16} />
              </button>
            </li>
          ))}
      </ol>
      {history && !history.points.length && (
        <Empty title="The next edit will create your first restore point." icon={<History />}>
          <p>Return here after changing a code, quote, grouping or memo. Restore points survive refreshes.</p>
        </Empty>
      )}
      {chosen && (
        <Dialog
          title="Review this restore point"
          subtitle={`Before: ${chosen.label}`}
          close={() => {
            if (!busy) setChosen(null);
          }}
        >
          <p>
            Restoring replaces this project’s current contents with the saved version. Your current version will become a new restore point.
          </p>
          <table className="restore-table">
            <thead>
              <tr>
                <th>Contents</th>
                <th>Current</th>
                <th>Saved version</th>
              </tr>
            </thead>
            <tbody>
              {(['transcripts', 'codes', 'quotes', 'memos', 'themes'] as const).map(key => (
                <tr key={key}>
                  <th>{key === 'themes' ? 'Groups / themes' : key}</th>
                  <td>{p[key].length}</td>
                  <td>{chosen.project[key].length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Saved project: {chosen.project.name} · {new Date(chosen.project.updatedAt).toLocaleString()}
          </p>
          <button onClick={() => download('margin-restore-point.margin.json', exportProject(chosen.project))}>
            <ArrowDownToLine size={16} />
            Download this version to inspect
          </button>
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setChosen(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (
                    await change(next => {
                      for (const key of Object.keys(next)) delete (next as unknown as Record<string, unknown>)[key];
                      Object.assign(next, copy(chosen.project));
                    }, 'Restored a saved project version.')
                  ) {
                    setChosen(null);
                    restored?.();
                  } else setError('Restore did not save. Your current version is unchanged.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore this version
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
