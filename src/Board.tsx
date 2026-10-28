import { useWorkspaceServices } from './WorkspaceContext';
import { HostedHandoffDialog, HostedJoinDialog } from './HostedSharing';
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useDurableDraft } from './drafts';
import { DraftStatus } from './DraftRecovery';
import { equal } from '../shared/operations.mjs';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  List as ListIcon,
  FolderInput,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';
import {
  addBoardNote,
  boardCSV,
  commentsCSV,
  download,
  editBoardNote,
  exportProject,
  MAX_NOTE,
  moveBoardNote,
  moveCard,
  moveGroup,
  removeBoardNote,
  removeQuote,
  now,
  required,
  uid,
  type BoardComment,
  type BoardGroup,
  type Project,
  type Quote,
} from './model';
import { sharingAvailable, type SharedConnection } from './collaboration';
import { Dialog, Empty, ErrorBox, Field } from './ui';
import { Evidence, type Change } from './Workbench';
export type CollaborationControls = { connection?: SharedConnection; create: () => Promise<void>; join: (id: string) => Promise<void> };
/** Titles written as "Section · Name" are grouped under their section in the jump bar. */
export const splitTitle = (title: string) => {
  const m = title.match(/^([^·]{1,20}) · (.+)$/);
  return m ? { section: m[1].trim(), name: m[2] } : { section: '', name: title };
};
/** Sticky-note papers, ordered so neighbouring groups never share a hue. */
const PAPERS = [
  '#fff2a6',
  '#ffd3df',
  '#cde7ff',
  '#d4f1c5',
  '#ffd9b3',
  '#e4daff',
  '#c6efe4',
  '#ffcfc7',
  '#e7f5b3',
  '#c7eef6',
  '#f6d0ee',
  '#efe2cc',
  '#d6ddff',
  '#dce8cf',
  '#ffe3c9',
];
/** Each group's paper, by its place in its section, so a group has one color wherever it appears. */
export function groupPapers(groups: BoardGroup[]) {
  const count = new Map<string, number>();
  const papers: Record<string, string> = {};
  for (const g of groups) {
    const section = splitTitle(g.title).section;
    const i = count.get(section) ?? 0;
    papers[g.id] = PAPERS[i % PAPERS.length];
    count.set(section, i + 1);
  }
  return papers;
}
/** "P04 session" reads as just "P04" on a sticky. */
const participant = (name = '') => name.replace(/\s+session$/i, '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const tally = (quotes: number, notes: number) => `${plural(quotes, 'quote')}${notes ? ` · ${plural(notes, 'note')}` : ''}`;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const UNGROUPED = 'ungrouped';
type Kind = 'quote' | 'note';
type Movable = { kind: Kind; id: string; text: string };
type Drag = { kind: Kind; id: string; height: number };
type Spot = { group: string; before?: string };
type Column = { id: string; title: string; name: string; note?: string; quoteIds: string[]; noteIds: string[]; paper: string };

export function QuoteBoard({
  project: p,
  change,
  read,
  list,
  importTranscript,
  jump,
  restore,
  error,
  collaboration,
}: {
  project: Project;
  keys?: Record<string, string>;
  change: Change;
  read: () => void;
  list: () => void;
  importTranscript: () => void;
  jump: (q: Quote) => void;
  restore: () => void;
  error: string;
  collaboration: CollaborationControls;
}) {
  const { hosted } = useWorkspaceServices();
  const [group, setGroup] = useState<BoardGroup | 'new' | null>(null),
    [moving, setMoving] = useState<Movable | null>(null),
    [opened, setOpened] = useState<{ quote: Quote; project: Project } | null>(null),
    [handoff, setHandoff] = useState(false),
    [drag, setDrag] = useState<Drag | null>(null),
    [spot, setSpot] = useState<Spot | null>(null),
    [tileOver, setTileOver] = useState(''),
    [writing, setWriting] = useState<{ group: string; id?: string } | null>(null),
    [expanded, setExpanded] = useState<Set<string>>(() => new Set()),
    [settled, setSettled] = useState(''),
    [flash, setFlash] = useState('');
  const wall = useRef<HTMLDivElement>(null);
  // The card being dragged, read synchronously by drop targets; `drag` only drives the faded look.
  const dragged = useRef<Drag | null>(null);
  // Which descriptions are open, and which section is picked, are per-device view preferences.
  const [about, setAbout] = useState<Record<string, boolean>>(() => readPref(`margin-about:${p.id}`, {}));
  const toggleAbout = (id: string) =>
    setAbout(state => {
      const next = { ...state, [id]: !state[id] };
      writePref(`margin-about:${p.id}`, next);
      return next;
    });
  const sections = [...new Set(p.boardGroups.map(g => splitTitle(g.title).section))];
  const indexed = sections.length > 1;
  const [picked, setPicked] = useState<string>(() => readPref(`margin-section:${p.id}`, ''));
  const section = indexed ? (sections.includes(picked) ? picked : sections[0]) : '';
  const { quotes, notes, sources, comments } = useMemo(
    () => ({
      quotes: new Map(p.quotes.map(q => [q.id, q])),
      notes: new Map(p.boardNotes.map(n => [n.id, n])),
      sources: new Map(p.transcripts.map(t => [t.id, t.name])),
      comments: p.comments.reduce((m, c) => m.set(c.quoteId, (m.get(c.quoteId) ?? 0) + 1), new Map<string, number>()),
    }),
    [p],
  );
  const papers = groupPapers(p.boardGroups);
  const filedQuotes = new Set(p.boardGroups.flatMap(g => g.quoteIds));
  const filedNotes = new Set(p.boardGroups.flatMap(g => g.noteIds ?? []));
  const ungrouped: Column = {
    id: UNGROUPED,
    title: 'Ungrouped',
    name: 'Ungrouped',
    quoteIds: p.quotes.filter(q => !filedQuotes.has(q.id)).map(q => q.id),
    noteIds: p.boardNotes.filter(n => !filedNotes.has(n.id)).map(n => n.id),
    paper: '#ffffff',
  };
  const columns: Column[] = [
    ...(ungrouped.quoteIds.length || ungrouped.noteIds.length ? [ungrouped] : []),
    ...p.boardGroups
      .filter(g => !indexed || splitTitle(g.title).section === section)
      .map(g => ({
        id: g.id,
        title: g.title,
        name: indexed ? splitTitle(g.title).name : g.title,
        note: g.note,
        quoteIds: g.quoteIds,
        noteIds: g.noteIds ?? [],
        paper: papers[g.id],
      })),
  ];

  useEffect(() => {
    if (!settled && !flash) return;
    const t = setTimeout(() => {
      setSettled('');
      setFlash('');
    }, 1200);
    return () => clearTimeout(t);
  }, [settled, flash]);

  function jumpTo(id: string) {
    const el = wall.current,
      col = el?.querySelector<HTMLElement>(`[data-group="${CSS.escape(id)}"]`);
    if (!el || !col) return;
    if (col.offsetLeft < el.scrollLeft || col.offsetLeft + col.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollTo({ left: Math.max(0, col.offsetLeft - 24), top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    setFlash(id);
  }
  async function place(card: { kind: Kind; id: string }, columnId: string, before?: string) {
    const target = columnId === UNGROUPED ? null : columnId;
    const ok =
      card.kind === 'quote'
        ? await change(next => moveCard(next, card.id, target, before), 'Quote card moved.')
        : await change(next => moveBoardNote(next, card.id, target, before), 'Note moved.');
    if (ok) {
      setMoving(null);
      setSettled(card.id);
    }
    return ok;
  }
  const submitMove = (card: Movable, groupId: string, before?: string) => place(card, groupId, before);

  // Drag a card onto a column (a dashed slot shows where it lands) or onto a group in the map.
  function startDrag(e: DragEvent, kind: Kind, id: string) {
    e.dataTransfer.setData('application/x-margin-card', `${kind}:${id}`);
    e.dataTransfer.effectAllowed = 'move';
    const card = { kind, id, height: (e.currentTarget as HTMLElement).offsetHeight };
    dragged.current = card;
    // Fade the card after the browser has taken its picture for the drag.
    requestAnimationFrame(() => setDrag(dragged.current && card));
  }
  function endDrag() {
    dragged.current = null;
    setDrag(null);
    setSpot(null);
    setTileOver('');
  }
  function overColumn(e: DragEvent<HTMLElement>, columnId: string) {
    const d = dragged.current;
    if (!d) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>(`[data-kind="${d.kind}"]`)].filter(el => el.dataset.id !== d.id);
    const before = cards.find(el => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    })?.dataset.id;
    setTileOver('');
    setSpot(s => (s?.group === columnId && s.before === before ? s : { group: columnId, before }));
  }
  function dropOnColumn(e: DragEvent, columnId: string) {
    const d = dragged.current;
    if (!d) return;
    e.preventDefault();
    const before = spot?.group === columnId ? spot.before : undefined;
    endDrag();
    void place(d, columnId, before);
  }
  function dropOnTile(e: DragEvent, c: Column) {
    const d = dragged.current;
    if (!d) return;
    e.preventDefault();
    endDrag();
    const top = (d.kind === 'quote' ? c.quoteIds : c.noteIds).find(id => id !== d.id);
    void place(d, c.id, top).then(ok => ok && setFlash(c.id));
  }
  // Drag the empty wall to slide along it, like a whiteboard.
  function pan(e: PointerEvent<HTMLDivElement>) {
    const el = wall.current;
    if (!el || e.button !== 0 || e.pointerType !== 'mouse') return;
    if ((e.target as HTMLElement).closest('.wall-note, .board-column-head, .group-note, button, a, input, textarea, select')) return;
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    el.classList.add('panning');
    const move = (m: globalThis.PointerEvent) => el.scrollTo(start.left - (m.clientX - start.x), start.top - (m.clientY - start.y));
    const stop = () => {
      el.classList.remove('panning');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  const slot = (kind: Kind, columnId: string, before?: string) =>
    drag?.kind === kind && spot?.group === columnId && spot.before === before ? (
      <div className="drop-slot" style={{ height: drag.height }} aria-hidden="true" />
    ) : null;
  function quoteCard(id: string) {
    const q = quotes.get(id);
    if (!q) return null;
    const count = comments.get(id) ?? 0;
    return (
      <article
        className={`sticky-card wall-note${expanded.has(id) ? ' open' : ''}${drag?.id === id ? ' lifted' : ''}${settled === id ? ' settled' : ''}`}
        data-kind="quote"
        data-id={id}
        data-quote-id={id}
        draggable
        onDragStart={e => startDrag(e, 'quote', id)}
        onDragEnd={endDrag}
        onClick={e => {
          if ((e.target as HTMLElement).closest('button, a') || getSelection()?.toString()) return;
          setExpanded(s => {
            const next = new Set(s);
            if (!next.delete(id)) next.add(id);
            return next;
          });
        }}
      >
        <blockquote>{q.text}</blockquote>
        <div className="quote-line">
          <span className="quote-who">{participant(sources.get(q.transcriptId))}</span>
          <span className="quote-actions">
            <button className="text-button" onClick={() => setOpened({ quote: q, project: p })}>
              Source & notes{count > 0 && <span className="note-count">{count}</span>}
            </button>
            <button
              className="text-button"
              aria-label={`Move card: ${q.text.slice(0, 50)}`}
              onClick={() => setMoving({ kind: 'quote', id, text: q.text })}
            >
              Move
            </button>
          </span>
        </div>
      </article>
    );
  }
  function noteCard(id: string, columnId: string) {
    const n = notes.get(id);
    if (!n) return null;
    const open = { group: columnId, id };
    if (writing?.id === id)
      return (
        <NoteDraft
          initial={n.text}
          save={text => change(next => editBoardNote(next, id, text), 'Note saved.')}
          remove={() => change(next => removeBoardNote(next, id), 'Note deleted.')}
          close={() => setWriting(w => (w?.id === id ? null : w))}
        />
      );
    return (
      <article
        className={`wall-note board-note${drag?.id === id ? ' lifted' : ''}${settled === id ? ' settled' : ''}`}
        data-kind="note"
        data-id={id}
        draggable
        title="Click to edit"
        onDragStart={e => startDrag(e, 'note', id)}
        onDragEnd={endDrag}
        onClick={e => {
          if (!(e.target as HTMLElement).closest('button')) setWriting(open);
        }}
      >
        <p className="note-words">{n.text}</p>
        <div className="quote-line">
          <span className="quote-who note-who">
            <Pencil size={13} aria-hidden="true" />
            {n.by || 'Note'}
          </span>
          <span className="quote-actions">
            <button className="text-button" onClick={() => setWriting(open)}>
              Edit
            </button>
            <button
              className="text-button"
              aria-label={`Move note: ${n.text.slice(0, 50)}`}
              onClick={() => setMoving({ kind: 'note', id, text: n.text })}
            >
              Move
            </button>
          </span>
        </div>
      </article>
    );
  }
  function column(c: Column) {
    const showAbout = !!about[c.id] && !!c.note;
    const adding = writing?.group === c.id && !writing.id;
    let created = '';
    return (
      <section
        key={c.id}
        id={`group-${c.id}`}
        className={`board-group${c.id === UNGROUPED ? ' ungrouped' : ''}${spot?.group === c.id ? ' drop-target' : ''}`}
        data-group={c.id}
        aria-label={`${c.title} quote group`}
        style={{ '--sticky': c.paper } as CSSProperties}
        onDragOver={e => overColumn(e, c.id)}
        onDrop={e => dropOnColumn(e, c.id)}
      >
        <div
          className={`board-column-head${c.note ? ' has-note' : ''}${flash === c.id ? ' flash' : ''}`}
          onClick={e => {
            // The whole label opens its description; its own buttons keep their actions.
            if (c.note && !(e.target as HTMLElement).closest('button')) toggleAbout(c.id);
          }}
        >
          <h2 className="group-title">{c.name}</h2>
          {(c.note || c.id !== UNGROUPED) && (
            <div className="group-actions">
              {c.note && (
                <button
                  className="group-toggle"
                  aria-label={`${showAbout ? 'Show less' : 'Read more'}: ${c.name}`}
                  aria-expanded={showAbout}
                  aria-controls={`group-note-${c.id}`}
                  onClick={() => toggleAbout(c.id)}
                >
                  {showAbout ? 'Show less' : 'Read more'}
                </button>
              )}
              {c.id !== UNGROUPED && (
                <button
                  className="group-edit"
                  aria-label={`Edit group ${c.title}`}
                  onClick={() => setGroup(p.boardGroups.find(x => x.id === c.id)!)}
                >
                  <Pencil size={13} aria-hidden="true" />
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
        {showAbout && (
          <div className="group-note" id={`group-note-${c.id}`}>
            {c.note!.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        )}
        <p className="group-meta">
          <span className="group-count">{c.quoteIds.length}</span>
          {c.quoteIds.length === 1 ? ' quote' : ' quotes'}
          {c.noteIds.length > 0 && ` · ${plural(c.noteIds.length, 'note')}`}
        </p>
        {c.id !== UNGROUPED && !adding && (
          <button className="add-note" aria-label={`Add note to ${c.name}`} onClick={() => setWriting({ group: c.id })}>
            <Plus size={17} aria-hidden="true" />
            Add note
          </button>
        )}
        <div className="board-stack">
          {adding && (
            <NoteDraft
              initial=""
              save={async text => {
                const ok = await change(next => {
                  created = addBoardNote(next, c.id, text, rememberedName()).id;
                }, 'Note added.');
                if (ok) setSettled(created);
                return ok;
              }}
              close={() => setWriting(w => (w?.group === c.id && !w.id ? null : w))}
            />
          )}
          {c.noteIds.map(id => (
            <Fragment key={id}>
              {slot('note', c.id, id)}
              {noteCard(id, c.id)}
            </Fragment>
          ))}
          {slot('note', c.id)}
          {c.quoteIds.map(id => (
            <Fragment key={id}>
              {slot('quote', c.id, id)}
              {quoteCard(id)}
            </Fragment>
          ))}
          {slot('quote', c.id)}
          {!c.quoteIds.length && !c.noteIds.length && !adding && !(spot?.group === c.id) && (
            <p className="group-empty">Drag quotes here, or add a note.</p>
          )}
        </div>
      </section>
    );
  }

  const currentQuote = opened ? p.quotes.find(q => q.id === opened.quote.id) : undefined;
  const active = currentQuote ?? opened?.quote;
  return (
    <section className="quote-board">
      <div className="board-toolbar">
        <h1>Board</h1>
        {indexed && (
          <nav className="section-index" aria-label="Board sections">
            {sections.map(name => (
              <button
                key={name || 'more'}
                className={name === section ? 'current' : ''}
                aria-current={name === section ? 'true' : undefined}
                onClick={() => {
                  setPicked(name);
                  writePref(`margin-section:${p.id}`, name);
                  wall.current?.scrollTo({ left: 0, top: 0 });
                }}
              >
                {name || 'More groups'}
              </button>
            ))}
          </nav>
        )}
        <div className="board-actions">
          <button className="text-button" onClick={() => setGroup('new')}>
            <Plus size={16} />
            New group
          </button>
          <button className="text-button" onClick={list}>
            <ListIcon size={16} />
            All quotes
          </button>
          <button className="text-button" onClick={() => setHandoff(true)}>
            <UsersRound size={16} />
            Work together
          </button>
        </div>
      </div>
      {!p.quotes.length && !p.boardGroups.length && !p.boardNotes.length ? (
        <Empty icon={<MessageSquare size={28} />} title="No quotes yet">
          <p>Highlight a participant’s words in a transcript to make a quote.</p>
          <button onClick={p.transcripts.length ? read : importTranscript}>
            {p.transcripts.length ? 'Open transcripts' : 'Import a transcript'}
            <ArrowRight size={16} />
          </button>
        </Empty>
      ) : (
        <>
          {columns.length > 3 && (
            <nav className="board-map" aria-label="Map of the board">
              {columns.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`map-tile${c.id === UNGROUPED ? ' ungrouped' : ''}${tileOver === c.id ? ' drop-target' : ''}${flash === c.id ? ' flash' : ''}`}
                  style={{ '--sticky': c.paper, '--size': Math.max(4, c.quoteIds.length + c.noteIds.length) } as CSSProperties}
                  title={c.name}
                  onClick={() => jumpTo(c.id)}
                  onDragOver={e => {
                    if (!dragged.current) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setSpot(null);
                    setTileOver(c.id);
                  }}
                  onDragLeave={() => setTileOver(t => (t === c.id ? '' : t))}
                  onDrop={e => dropOnTile(e, c)}
                >
                  <span className="map-name">{c.name}</span>
                  <span className="map-count">{tally(c.quoteIds.length, c.noteIds.length)}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="board-wall" ref={wall} onPointerDown={pan}>
            <div className="group-list board-columns">
              {columns.map(column)}
              <button type="button" className="add-group" onClick={() => setGroup('new')}>
                <Plus size={16} />
                Add a group
              </button>
            </div>
          </div>
        </>
      )}
      {group && <GroupDialog group={group} project={p} close={() => setGroup(null)} change={change} error={error} />}
      {moving && <MoveDialog card={moving} project={p} close={() => setMoving(null)} submit={submitMove} error={error} />}
      {active && (
        <CardDialog
          quote={active}
          project={currentQuote ? p : opened!.project}
          close={() => setOpened(null)}
          change={change}
          jump={q => {
            setOpened(null);
            jump(q);
          }}
          error={
            currentQuote
              ? error
              : 'This quote was removed from the current project. Your open writing stays here; download or keep its draft before leaving.'
          }
        />
      )}
      {handoff &&
        (hosted ? (
          <HostedHandoffDialog collaboration={collaboration} project={p} close={() => setHandoff(false)} />
        ) : (
          <HandoffDialog
            collaboration={collaboration}
            project={p}
            close={() => setHandoff(false)}
            restore={() => {
              setHandoff(false);
              restore();
            }}
          />
        ))}
    </section>
  );
}
/** Writing a note in place. Enter or leaving the box saves; Escape puts it away unchanged. */
function NoteDraft({
  initial,
  save,
  remove,
  close,
}: {
  initial: string;
  save: (text: string) => Promise<boolean>;
  remove?: () => Promise<boolean>;
  close: () => void;
}) {
  const [text, setText] = useState(initial),
    [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);
  async function finish(how: 'save' | 'cancel' | 'remove') {
    if (done.current) return;
    done.current = true;
    const body = text.trim();
    let ok = true;
    if (how === 'remove' || (how === 'save' && body && body !== initial.trim())) {
      setBusy(true);
      ok = await (how === 'remove' ? remove!() : save(body));
      setBusy(false);
    }
    // A failed save keeps the writing open so nothing is lost.
    if (ok) close();
    else done.current = false;
  }
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  return (
    <div className="wall-note board-note writing">
      <textarea
        ref={area}
        className="note-input"
        aria-label="Note"
        placeholder="Write a note…"
        value={text}
        maxLength={MAX_NOTE}
        disabled={busy}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void finish('save');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            void finish('cancel');
          }
        }}
        onBlur={() => setTimeout(() => void finish('save'))}
      />
      <div className="note-tools">
        {remove ? (
          <button type="button" className="text-button note-delete" onMouseDown={keepFocus} onClick={() => void finish('remove')}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="primary note-done" onMouseDown={keepFocus} onClick={() => void finish('save')}>
          Done
        </button>
      </div>
    </div>
  );
}
const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* View preferences only. */
  }
};
export function GroupDialog({
  group,
  project,
  close,
  change,
  error,
}: {
  group: BoardGroup | 'new';
  project: Project;
  close: () => void;
  change: Change;
  error: string;
}) {
  const original = group === 'new' ? null : group;
  const [busy, setBusy] = useState(false);
  const draft = useDurableDraft(
    { projectId: project.id, kind: 'group', label: 'Unfinished board group', entityId: original?.id, base: original },
    { title: original?.title ?? '', color: original?.color ?? (project.boardGroups.length + 1) % 6, note: original?.note ?? '' },
  );
  const { title, color } = draft.value;
  const note: string = draft.value.note ?? '';
  const setTitle = (title: string) => draft.update({ ...draft.value, title }),
    setNote = (note: string) => draft.update({ ...draft.value, note });
  const closeDraft = () => {
    if (!busy && (!draft.error || window.confirm('This draft could not be stored. Close and lose the unsaved writing?'))) close();
  };

  return (
    <Dialog title={original ? 'Edit group' : 'New group'} close={closeDraft}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            if (
              await change(
                p => {
                  const name = required(title, 'Group name');
                  if (original) {
                    const g = p.boardGroups.find(x => x.id === original.id);
                    if (!g || !equal(g, original))
                      throw new Error('This group changed while its editor was open. Your draft is kept for review.');
                    g.title = name;
                    g.color = color;
                    if (note.trim()) g.note = note;
                    else delete g.note;
                    g.updatedAt = now();
                  } else {
                    const date = now();
                    p.boardGroups.push({
                      id: uid(),
                      title: name,
                      ...(note.trim() ? { note } : {}),
                      color,
                      quoteIds: [],
                      createdAt: date,
                      updatedAt: date,
                    });
                  }
                },
                original ? 'Board group updated.' : 'Board group created.',
              )
            ) {
              if (draft.clear()) close();
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Group name">
          <input
            disabled={busy}
            required
            maxLength={120}
            data-autofocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What connects these cards?"
          />
        </Field>
        <Field label="Description" hint="Optional. Opens when someone clicks the column header.">
          <textarea disabled={busy} rows={4} maxLength={100_000} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        {original && (
          <div className="group-position">
            <span>Position</span>
            <button
              type="button"
              disabled={busy || project.boardGroups[0]?.id === original.id}
              onClick={() => change(p => moveGroup(p, original.id, -1), 'Group moved left.')}
            >
              <ArrowLeft size={16} />
              Move left
            </button>
            <button
              type="button"
              disabled={busy || project.boardGroups.at(-1)?.id === original.id}
              onClick={() => change(p => moveGroup(p, original.id, 1), 'Group moved right.')}
            >
              Move right
              <ArrowRight size={16} />
            </button>
          </div>
        )}
        <DraftStatus draft={draft} />
        <ErrorBox error={error} />
        <div className="dialog-actions wrap">
          {original && (
            <button
              type="button"
              className="text-button delete-link"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Remove this group? Its cards move to Ungrouped.')) return;
                setBusy(true);
                try {
                  if (
                    await change(p => {
                      if (
                        !equal(
                          p.boardGroups.find(g => g.id === original.id),
                          original,
                        )
                      )
                        throw new Error('This group changed. Review it before removing it.');
                      p.boardGroups = p.boardGroups.filter(g => g.id !== original.id);
                    }, 'Group removed. Its quote cards and notes are kept.')
                  )
                    close();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={15} />
              Remove group
            </button>
          )}
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {original ? 'Save group' : 'Create group'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function MoveDialog({
  card,
  project: p,
  close,
  submit,
  error,
}: {
  card: Movable;
  project: Project;
  close: () => void;
  submit: (card: Movable, group: string, before?: string) => Promise<boolean>;
  error: string;
}) {
  const quote = card.kind === 'quote';
  const cardsIn = (g?: BoardGroup) => (quote ? g?.quoteIds : g?.noteIds) ?? [];
  const textOf = (id: string) => (quote ? p.quotes.find(q => q.id === id)?.text : p.boardNotes.find(n => n.id === id)?.text) ?? '';
  const [target, setTarget] = useState(p.boardGroups.find(g => cardsIn(g).includes(card.id))?.id ?? 'ungrouped'),
    [before, setBefore] = useState(''),
    [busy, setBusy] = useState(false);
  const candidates = cardsIn(p.boardGroups.find(g => g.id === target)).filter(id => id !== card.id);
  return (
    <Dialog
      title={quote ? 'Move this quote card' : 'Move this note'}
      subtitle={
        quote
          ? 'Moving changes its place on the board. The source, codes and notes stay with it.'
          : 'Moving changes which group it sits in.'
      }
      close={close}
    >
      {quote ? <blockquote className="move-preview">{card.text}</blockquote> : <p className="move-preview">{card.text}</p>}
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            await submit(card, target, before || undefined);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Move to group">
          <select
            data-autofocus
            value={target}
            onChange={e => {
              setTarget(e.target.value);
              setBefore('');
            }}
          >
            <option value="ungrouped">Ungrouped</option>
            {p.boardGroups.map(g => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>
        {target !== 'ungrouped' && (
          <Field label="Position in group">
            <select value={before} onChange={e => setBefore(e.target.value)}>
              <option value="">{quote ? 'After the other cards' : 'After the other notes'}</option>
              {candidates.map(id => (
                <option key={id} value={id}>
                  Before: {textOf(id).slice(0, 75)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {quote ? 'Move card' : 'Move note'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
const rememberedName = () => {
  try {
    return localStorage.getItem('margin-name') ?? '';
  } catch {
    return '';
  }
};
const rememberName = (name: string) => {
  try {
    localStorage.setItem('margin-name', name.trim());
  } catch {
    /* Convenience only. */
  }
};
function CardDialog({
  quote: q,
  project: p,
  close,
  change,
  jump,
  error,
}: {
  quote: Quote;
  project: Project;
  close: () => void;
  change: Change;
  jump: (q: Quote) => void;
  error: string;
}) {
  const [editing, setEditing] = useState<BoardComment | null>(null),
    [generation, setGeneration] = useState(0),
    [busy, setBusy] = useState(false),
    [unsafe, setUnsafe] = useState(false);
  function mayLeave() {
    return (
      !busy &&
      (!unsafe || window.confirm('This writing could not be stored. Download or copy it before leaving. Close and lose the unsaved text?'))
    );
  }
  function leave(action: () => void) {
    if (mayLeave()) action();
  }
  function reset() {
    setEditing(null);
    setGeneration(n => n + 1);
  }
  return (
    <Dialog wide title="Source & notes" close={() => leave(close)}>
      <Evidence quote={q} project={p} jump={quote => leave(() => jump(quote))} />
      <button
        type="button"
        className="text-button delete-link"
        disabled={busy}
        onClick={async () => {
          if (!mayLeave()) return;
          const n = p.comments.filter(c => c.quoteId === q.id).length;
          if (!window.confirm(`Remove this card${n ? ` and its ${n === 1 ? 'note' : `${n} notes`}` : ''}? Undo brings it back.`)) return;
          setBusy(true);
          const ok = await change(next => removeQuote(next, q.id), 'Quote card removed.');
          setBusy(false);
          if (ok) close();
        }}
      >
        <Trash2 size={15} />
        Remove card
      </button>
      <section className="card-comments" aria-label="Human notes on this card">
        <h3>
          Notes <span>{p.comments.filter(c => c.quoteId === q.id).length}</span>
        </h3>
        {p.comments
          .filter(c => c.quoteId === q.id)
          .map(c => (
            <article className="card-comment" key={c.id}>
              <div>
                <strong>{c.by}</strong>
                <small>{new Date(c.updatedAt).toLocaleString()}</small>
              </div>
              <p>{c.body}</p>
              <div className="comment-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    leave(() => {
                      setEditing(c);
                      setGeneration(n => n + 1);
                    })
                  }
                >
                  Edit note
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    if (!mayLeave()) return;
                    if (!window.confirm('Remove this note? A restore point will keep the previous version.')) return;
                    setBusy(true);
                    try {
                      if (
                        await change(next => {
                          const current = next.comments.find(x => x.id === c.id);
                          if (!equal(current, c)) throw new Error('This note changed. Review its current version before removing it.');
                          next.comments = next.comments.filter(x => x.id !== c.id);
                        }, 'Card note removed.')
                      ) {
                        if (editing?.id === c.id) reset();
                      }
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove note
                </button>
              </div>
            </article>
          ))}
        <NoteEditor
          key={`${editing?.id ?? 'new'}:${generation}`}
          project={p}
          quote={q}
          editing={editing}
          busy={busy}
          setBusy={setBusy}
          change={change}
          reset={reset}
          unsafe={setUnsafe}
          error={error}
        />
      </section>
    </Dialog>
  );
}
function NoteEditor({
  project,
  quote,
  editing,
  busy,
  setBusy,
  change,
  reset,
  error,
  unsafe,
}: {
  project: Project;
  quote: Quote;
  editing: BoardComment | null;
  unsafe: (value: boolean) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  change: Change;
  reset: () => void;
  error: string;
}) {
  const draft = useDurableDraft(
    {
      projectId: project.id,
      kind: 'note',
      label: editing ? 'Unfinished card note edit' : 'Unfinished card note',
      entityId: editing?.id,
      quoteId: quote.id,
      base: editing,
    },
    { by: editing?.by ?? rememberedName(), body: editing?.body ?? '' },
  );
  const { by, body } = draft.value;
  useEffect(() => {
    unsafe(!!draft.error && draft.dirty);
    return () => unsafe(false);
  }, [draft.error, draft.dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draft.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [draft.dirty]);
  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        if (busy) return;
        const submitted = { by, body };
        setBusy(true);
        try {
          if (
            await change(
              next => {
                const name = required(by, 'Your name', 80),
                  date = now();
                required(body, 'Note', 20_000);
                if (!next.quotes.some(q => q.id === quote.id))
                  throw new Error('The quote was removed. Your writing draft is kept for recovery.');
                if (editing) {
                  const c = next.comments.find(c => c.id === editing.id);
                  if (!c || !equal(c, editing))
                    throw new Error(
                      'This note changed while you were writing. Your draft is saved; use Draft recovery to keep it as a separate note.',
                    );
                  c.by = name;
                  c.body = body;
                  c.updatedAt = date;
                } else
                  next.comments.push({ id: uid(), quoteId: quote.id, by: name, body, author: 'user', createdAt: date, updatedAt: date });
              },
              editing ? 'Card note updated.' : 'Your note was added to this card.',
            )
          ) {
            rememberName(submitted.by);
            if (draft.clear(submitted)) reset();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Your name">
        <input
          disabled={busy}
          required
          maxLength={80}
          value={by}
          onChange={e => draft.update({ by: e.target.value, body })}
          placeholder="Name or initials"
        />
      </Field>
      <Field label={editing ? 'Edit your note' : 'Your note'}>
        <textarea
          disabled={busy}
          required
          rows={4}
          maxLength={20_000}
          value={body}
          onChange={e => draft.update({ by, body: e.target.value })}
          placeholder="Write what you want to discuss…"
        />
      </Field>
      <p className="small muted" role="status">
        {draft.saved ? 'Writing draft saved on this device. Closing keeps it in Draft recovery.' : ''}
      </p>
      <ErrorBox error={draft.error || error} />
      {draft.error && (
        <button type="button" onClick={() => download('margin-unsaved-writing.json', draft.raw())}>
          Download this writing now
        </button>
      )}
      <div className="dialog-actions">
        {editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!draft.error || window.confirm('This writing could not be stored. Close and lose the unsaved text?')) reset();
            }}
          >
            Close edit · keep draft
          </button>
        )}
        <button className="primary" disabled={busy}>
          {editing ? 'Save note' : 'Add note'}
        </button>
      </div>
    </form>
  );
}
function HandoffDialog({
  project: p,
  close,
  restore,
  collaboration,
}: {
  project: Project;
  close: () => void;
  restore: () => void;
  collaboration: CollaborationControls;
}) {
  const [available, setAvailable] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    sharingAvailable().then(setAvailable);
  }, []);
  const name = p.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  return (
    <Dialog wide title="Work together" close={close}>
      <section className="share-option">
        <h3>On this computer</h3>
        <p>Open Margin in a second browser here and join with the room ID. Saved edits show up in both.</p>
        {collaboration.connection ? (
          <Field label="Local room ID">
            <input readOnly value={collaboration.connection.roomId} onFocus={e => e.target.select()} />
          </Field>
        ) : (
          <button
            className="primary"
            disabled={!available || busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await collaboration.create();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <UsersRound size={17} />
            Start local live session
          </button>
        )}
        {available === false && <p className="small muted">Live sessions need Margin's local server running.</p>}
        <ErrorBox error={error} />
      </section>
      <section className="share-option">
        <h3>Send a copy</h3>
        <p>
          Download a copy and send it however your lab shares files. The other person opens it as their own project. Copies don't merge
          back.
        </p>
        <div className="button-row">
          <button onClick={() => download(`${name}.margin.json`, exportProject(p))}>
            <ArrowDownToLine size={16} />
            Download a copy
          </button>
          <button onClick={restore}>
            <FolderInput size={16} />
            Open a copy
          </button>
        </div>
      </section>
      <p className="share-csv">
        Spreadsheet:{' '}
        <button className="text-button" onClick={() => download(`${name}-board.csv`, boardCSV(p), 'text/csv;charset=utf-8')}>
          Board CSV
        </button>{' '}
        ·{' '}
        <button className="text-button" onClick={() => download(`${name}-notes.csv`, commentsCSV(p), 'text/csv;charset=utf-8')}>
          Notes CSV
        </button>
      </p>
    </Dialog>
  );
}

function LocalJoinRoomDialog({ join, close }: { join: (id: string) => Promise<void>; close: () => void }) {
  const [id, setId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title="Join a local board" subtitle="Paste the room ID from the other browser." close={close}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await join(id);
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Local room ID">
          <input
            required
            data-autofocus
            value={id}
            maxLength={100}
            onChange={e => setId(e.target.value)}
            placeholder="Paste the ID from Work together"
          />
        </Field>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Join board
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function JoinRoomDialog(props: { close: () => void; join: (id: string) => Promise<void> }) {
  const { hosted } = useWorkspaceServices();
  return hosted ? <HostedJoinDialog {...props} /> : <LocalJoinRoomDialog {...props} />;
}
