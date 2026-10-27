import { describe, expect, it } from 'vitest';
import { applyOperation, assertImmutableSources, diffProject, inverseOperation, validateOperation } from '../shared/operations.mjs';
import type { Operation } from '../shared/operations.mjs';
import { addBoardNote, makeTranscript, newProject, removeQuote, saveQuoteCard, validateProject } from '../src/model';
import type { BoardComment, Project } from '../src/model';

const AT = '2026-10-04T12:00:00.000Z';

function fixture(withNote = false): Project {
  const project = newProject('Synthetic conditional-operation practice', true);
  const transcript = makeTranscript('Synthetic source', 'Interviewer: What helped?\r\nParticipant: A green 🌱 sign helped.\r\nThe words stayed with me.');
  transcript.turns[0].role = 'interviewer';
  transcript.turns[1].role = 'participant';
  project.transcripts.push(transcript);
  const turn = transcript.turns[1];
  saveQuoteCard(project, transcript.id, turn.id, turn.start, turn.end, transcript.text.slice(turn.start, turn.end));
  if (withNote) project.comments.push(note(project, 'existing-note', 'Original user-authored note.'));
  return validateProject(project);
}

function note(project: Project, id: string, body: string): BoardComment {
  return { id, quoteId: project.quotes[0].id, by: 'Synthetic reviewer', body, author: 'user', createdAt: AT, updatedAt: AT };
}

function operation(before: Project, edit: (after: Project) => void): Operation {
  const after = structuredClone(before);
  edit(after);
  return { id: crypto.randomUUID(), projectId: before.id, at: AT, label: 'Synthetic manual edit', changes: diffProject(before, after) };
}

function applied(before: Project, op: Operation): Project {
  const result = applyOperation(before, op);
  expect(result.conflicts).toEqual([]);
  expect(result.project).not.toBeNull();
  return result.project!;
}

describe('conditional record operations', () => {
  it.each([false, true])('retains two independent notes in either arrival order (reverse=%s)', reverse => {
    const base = fixture();
    const original = structuredClone(base);
    const ops = [
      operation(base, p => p.comments.push(note(p, 'note-a', 'A manually entered observation.'))),
      operation(base, p => p.comments.push(note(p, 'note-b', 'A second manually entered observation.'))),
    ];
    if (reverse) ops.reverse();
    const result = applied(applied(base, ops[0]), ops[1]);
    expect(result.comments.map(c => c.id).sort()).toEqual(['note-a', 'note-b']);
    expect(validateProject(result).quotes).toEqual(base.quotes);
    expect(result.transcripts).toEqual(base.transcripts);
    expect(base).toEqual(original);
  });

  it('detects competing edits to an existing note without applying any part of the loser', () => {
    const base = fixture(true);
    const first = operation(base, p => { p.comments[0].body = 'First reviewer edit.'; });
    const second = operation(base, p => {
      p.comments[0].body = 'Second reviewer edit.';
      p.name = 'This name must not partially apply';
    });
    const current = applied(base, first);
    const snapshot = structuredClone(current);
    const rejected = applyOperation(current, second);
    expect(rejected.project).toBeNull();
    expect(rejected.conflicts.map(c => c.id)).toEqual(['existing-note']);
    expect(current).toEqual(snapshot);
    expect(current.name).toBe(base.name);
  });

  it.each(['delete-first', 'edit-first'] as const)('rejects note deletion versus edit races: %s', order => {
    const base = fixture(true);
    const deletion = operation(base, p => { p.comments = []; });
    const edit = operation(base, p => { p.comments[0].body = 'A newer user-authored note.'; });
    const [first, second] = order === 'delete-first' ? [deletion, edit] : [edit, deletion];
    const current = applied(base, first);
    expect(applyOperation(current, second)).toMatchObject({ project: null, conflicts: [{ id: 'existing-note' }] });
    expect(current.comments).toHaveLength(order === 'delete-first' ? 0 : 1);
  });

  it.each(['delete-first', 'note-first'] as const)('requires whole-graph validation for quote deletion versus a new note: %s', order => {
    const base = fixture();
    const deletion = operation(base, p => removeQuote(p, p.quotes[0].id));
    const add = operation(base, p => p.comments.push(note(p, 'new-note', 'A note linked to this exact quote.')));
    const [first, second] = order === 'delete-first' ? [deletion, add] : [add, deletion];
    const current = applied(base, first);
    const snapshot = structuredClone(current);
    const candidate = applied(current, second);
    // The conditional operation primitive is deliberately followed by model validation.
    // Distinct records can pass preconditions while their combined graph is invalid.
    expect(() => validateProject(candidate)).toThrow();
    expect(validateProject(current)).toEqual(snapshot);
    expect(current).toEqual(snapshot);
  });

  it('copies changed records into the delta and ignores updatedAt-only changes', () => {
    const base = fixture(true);
    const next = structuredClone(base);
    next.updatedAt = AT;
    expect(diffProject(base, next)).toEqual([]);
    next.comments[0].body = 'Captured change.';
    const changes = diffProject(base, next);
    next.comments[0].body = 'A later unsaved draft.';
    base.comments[0].body = 'Changed outside the captured delta.';
    expect(changes[0].before.body).toBe('Original user-authored note.');
    expect(changes[0].after.body).toBe('Captured change.');
  });

  it('rejects applying a valid operation to another project', () => {
    const base = fixture(true);
    const op = operation(base, p => { p.comments[0].body = 'Changed.'; });
    const other = fixture(true);
    expect(() => applyOperation(other, op)).toThrow(/different project/i);
    expect(() => diffProject(base, other)).toThrow(/identity/i);
  });
});

describe('scoped inverse undo', () => {
  it('undoes only the local note while retaining an unrelated later remote note', () => {
    const base = fixture(true);
    const local = operation(base, p => { p.comments[0].body = 'My edit.'; });
    const remote = operation(base, p => p.comments.push(note(p, 'remote-note', 'Another reviewer\'s note.')));
    const current = applied(applied(base, local), remote);
    const undo = inverseOperation(local, crypto.randomUUID(), '2026-10-04T12:02:00.000Z');
    expect(undo.id).not.toBe(local.id);
    const restored = applied(current, undo);
    expect(restored.comments.find(c => c.id === 'existing-note')).toEqual(base.comments[0]);
    expect(restored.comments.find(c => c.id === 'remote-note')?.body).toBe('Another reviewer\'s note.');
    expect(restored.quotes).toEqual(base.quotes);
    expect(restored.transcripts).toEqual(base.transcripts);
    expect(validateProject(restored)).toEqual(restored);
  });

  it('refuses inverse undo when a later remote edit changed the same note', () => {
    const base = fixture(true);
    const local = operation(base, p => { p.comments[0].body = 'My edit.'; });
    const afterLocal = applied(base, local);
    const remote = operation(afterLocal, p => { p.comments[0].body = 'Their later edit.'; });
    const current = applied(afterLocal, remote);
    const undo = inverseOperation(local, crypto.randomUUID(), AT);
    expect(applyOperation(current, undo)).toMatchObject({ project: null, conflicts: [{ id: 'existing-note' }] });
    expect(current.comments[0].body).toBe('Their later edit.');
  });
});

describe('operation and provenance boundaries', () => {
  const malformed: [string, (op: Operation) => void][] = [
    ['non-UUID operation ID', op => { op.id = '-'.repeat(36); }],
    ['duplicate record changes', op => { op.changes.push(structuredClone(op.changes[0])); }],
    ['mismatched record ID', op => { op.changes[0].after.id = 'different-record'; }],
    ['unknown collection', op => { (op.changes[0] as { collection: string }).collection = 'unknown'; }],
    ['missing before value', op => { delete (op.changes[0] as Partial<typeof op.changes[0]>).before; }],
    ['invalid operation date', op => { op.at = 'yesterday'; }],
    ['empty delta', op => { op.changes = []; }],
  ];
  it.each(malformed)('rejects %s without modifying the input project', (_name, corrupt) => {
    const base = fixture(true);
    const original = structuredClone(base);
    const op = operation(base, p => { p.comments[0].body = 'Changed.'; });
    corrupt(op);
    expect(() => validateOperation(op)).toThrow();
    expect(() => applyOperation(base, op)).toThrow();
    expect(base).toEqual(original);
  });

  const changesToEvidence: [string, (p: Project) => void][] = [
    ['original source text', p => { p.transcripts[0].text = p.transcripts[0].text.replace('green', 'amber'); }],
    ['turn identity', p => { p.transcripts[0].turns[1].id = 'replacement-turn'; }],
    ['turn UTF-16 start', p => { p.transcripts[0].turns[1].start += 1; }],
    ['turn UTF-16 end', p => { p.transcripts[0].turns[1].end -= 1; }],
    ['quote source identity', p => { p.quotes[0].transcriptId = 'replacement-source'; }],
    ['quote turn identity', p => { p.quotes[0].turnId = 'replacement-turn'; }],
    ['quote UTF-16 start', p => { p.quotes[0].start += 1; }],
    ['quote UTF-16 end', p => { p.quotes[0].end -= 1; }],
    ['quote text', p => { p.quotes[0].text = 'A paraphrase is not a quote.'; }],
    ['quote creation date', p => { p.quotes[0].createdAt = AT; }],
  ];
  it.each(changesToEvidence)('rejects mutation of %s on a surviving record', (_name, edit) => {
    const before = fixture();
    const after = structuredClone(before);
    edit(after);
    expect(() => assertImmutableSources(before, after)).toThrow();
  });

  it('allows manual source labels and card comments without changing exact evidence', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.transcripts[0].name = 'Synthetic source, labeled by a person';
    after.transcripts[0].turns[1].label = 'Synthetic participant';
    after.comments.push(note(after, 'new-note', 'A human-authored interpretation.'));
    expect(() => assertImmutableSources(before, after)).not.toThrow();
    const checked = validateProject(after);
    expect(checked.quotes[0].text).toContain('🌱');
    expect(checked.quotes[0].text).toContain('\r\n');
    expect(checked.quotes[0].text).toBe(before.quotes[0].text);
  });
});

describe('board notes', () => {
  it('sync to, and undo on, a shared project saved before notes existed', () => {
    const before = fixture();
    const after = structuredClone(before);
    addBoardNote(after, null, 'A synthetic thought.');
    const op: Operation = { id: crypto.randomUUID(), projectId: before.id, at: AT, label: 'Note added.', changes: diffProject(before, after) };
    expect(op.changes.map(c => c.collection)).toEqual(['boardNotes']);
    const stored = structuredClone(before) as Partial<Project>;
    delete stored.boardNotes;
    const applied = applyOperation(stored as Project, validateOperation(op));
    expect(applied.conflicts).toEqual([]);
    expect(applied.project!.boardNotes).toEqual(after.boardNotes);
    const undone = applyOperation(applied.project!, inverseOperation(op, crypto.randomUUID(), AT));
    expect(undone.project!.boardNotes).toEqual([]);
    expect(validateProject(undone.project).boardNotes).toEqual([]);
  });
});
