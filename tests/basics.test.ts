import { describe, expect, it } from 'vitest';
import {
  addCode,
  assignQuote,
  makeTranscript,
  moveGroup,
  newProject,
  removeCode,
  removeMemo,
  removeTranscript,
  renameProject,
  renameTranscript,
  validateProject,
} from '../src/model';

function fixture() {
  const p = newProject('Synthetic basics');
  for (const name of ['One', 'Two']) {
    const t = makeTranscript(name, `Interviewer: Why?\nP1: Because the ${name} words matter.`, p.transcripts);
    t.turns.forEach(x => (x.role = x.label === 'P1' ? 'participant' : 'interviewer'));
    p.transcripts.push(t);
  }
  const c = addCode(p, 'Reasons');
  const [a, b] = p.transcripts.map(t => assignQuote(p, t.id, t.turns[1].id, t.turns[1].start, t.turns[1].end, [c.id]));
  const date = new Date().toISOString();
  p.boardGroups.push(
    { id: 'g1', title: 'First', color: 0, quoteIds: [a.id], createdAt: date, updatedAt: date },
    { id: 'g2', title: 'Second', color: 1, quoteIds: [b.id], createdAt: date, updatedAt: date },
  );
  p.comments.push({ id: 'n1', quoteId: a.id, by: 'Me', body: 'A note', author: 'user', createdAt: date, updatedAt: date });
  p.memos.push({ id: 'm1', title: 'Memo', body: '', author: 'user', createdAt: date, updatedAt: date, quoteIds: [a.id, b.id] });
  p.themes.push({
    id: 't1',
    title: 'Theme',
    body: '',
    author: 'user',
    kind: 'theme',
    codeIds: [c.id],
    quoteIds: [a.id],
    createdAt: date,
    updatedAt: date,
  });
  return { p, c, a, b };
}

describe('basic edits', () => {
  it('renames a project and a transcript, refusing blanks and duplicate transcript names', () => {
    const { p } = fixture();
    renameProject(p, '  Renamed  ');
    expect(p.name).toBe('Renamed');
    expect(() => renameProject(p, ' ')).toThrow();
    renameTranscript(p, p.transcripts[0].id, 'Session A');
    expect(p.transcripts[0].name).toBe('Session A');
    expect(() => renameTranscript(p, p.transcripts[1].id, 'session a')).toThrow(/already has that name/);
    expect(() => validateProject(p)).not.toThrow();
  });
  it('removes a transcript with every card taken from it and leaves a valid project', () => {
    const { p, a, b } = fixture();
    removeTranscript(p, p.transcripts[0].id);
    expect(p.transcripts.map(t => t.name)).toEqual(['Two']);
    expect(p.quotes.map(q => q.id)).toEqual([b.id]);
    expect(p.comments).toEqual([]);
    expect(p.boardGroups[0].quoteIds).toEqual([]);
    expect(p.memos[0].quoteIds).toEqual([b.id]);
    expect(p.themes[0].quoteIds).not.toContain(a.id);
    expect(() => validateProject(p)).not.toThrow();
  });
  it('removes a code but keeps its quote cards', () => {
    const { p, c } = fixture();
    removeCode(p, c.id);
    expect(p.codes).toEqual([]);
    expect(p.quotes).toHaveLength(2);
    expect(p.quotes.every(q => q.codeIds.length === 0)).toBe(true);
    expect(p.themes[0].codeIds).toEqual([]);
    expect(() => validateProject(p)).not.toThrow();
  });
  it('removes a memo and moves board groups within bounds', () => {
    const { p } = fixture();
    removeMemo(p, 'm1');
    expect(p.memos).toEqual([]);
    moveGroup(p, 'g2', -1);
    expect(p.boardGroups.map(g => g.id)).toEqual(['g2', 'g1']);
    moveGroup(p, 'g2', -1);
    expect(p.boardGroups.map(g => g.id)).toEqual(['g2', 'g1']);
    expect(() => validateProject(p)).not.toThrow();
  });
});

describe('board group notes', () => {
  it('accepts an optional note and rejects a malformed one', () => {
    const { p } = fixture();
    p.boardGroups[0].note = 'What the paper says about this finding.';
    expect(() => validateProject(p)).not.toThrow();
    (p.boardGroups[0] as { note?: unknown }).note = 42;
    expect(() => validateProject(p)).toThrow(/malformed board group/);
    p.boardGroups[0].note = 'x'.repeat(100_001);
    expect(() => validateProject(p)).toThrow(/malformed board group/);
  });
});
