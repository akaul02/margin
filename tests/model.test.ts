import { describe, expect, it } from 'vitest';
import { addCode, assignQuote, byteLength, codeCSV, copy, exportProject, importProject, makeTranscript, mergeCodes, newProject, parseTurns, quoteCSV, renameCode, setRole, sourceOffsetFromTextarea, validateProject } from '../src/model';
function fixture() {
  const p = newProject('Synthetic test');
  const t = makeTranscript('A synthetic conversation', 'Interviewer: Why?\r\nParticipant: It felt 🌱 familiar.\r\nSecond line, unchanged.\r\nInterviewer: Anything else?');
  t.turns.forEach(x => x.role = x.label === 'Participant' ? 'participant' : 'interviewer'); p.transcripts.push(t);
  const c = addCode(p, 'Familiarity', 'A user-chosen definition'); const turn = t.turns[1];
  return { p, t, c, turn };
}
describe('immutable source evidence', () => {
  it('keeps CRLF, Unicode and exact UTF-16 spans through lossless round trip', () => {
    const { p, t, c, turn } = fixture(); const q = assignQuote(p, t.id, turn.id, turn.start + 3, turn.end, [c.id]);
    expect(q.text).toBe(t.text.slice(turn.start + 3, turn.end)); expect(q.text).toContain('🌱');
    p.memos.push({ id: 'user-memo', title: 'My reflection', body: 'User authored only.', author: 'user', quoteIds: [], createdAt: p.createdAt, updatedAt: p.updatedAt });
    expect(importProject(exportProject(p))).toEqual(p); expect(importProject(exportProject(p)).transcripts[0].text).toBe(t.text);
  });
  it('blocks interviewer, unassigned, cross-turn and whitespace-only evidence', () => {
    const { p, t, c, turn } = fixture();
    expect(() => assignQuote(p, t.id, t.turns[0].id, t.turns[0].start, t.turns[0].end, [c.id])).toThrow(/participant/);
    expect(() => assignQuote(p, t.id, turn.id, turn.start, t.turns[2].end, [c.id])).toThrow(/within one/);
    setRole(p, t.id, turn.id, 'unassigned'); expect(() => assignQuote(p, t.id, turn.id, turn.start, turn.end, [c.id])).toThrow(/participant/);
  });
  it('protects coded turns and deduplicates the same exact quote', () => {
    const { p, t, c, turn } = fixture(); const b = addCode(p, 'Another code');
    const q = assignQuote(p, t.id, turn.id, turn.start, turn.end, [c.id]);
    const same = assignQuote(p, t.id, turn.id, turn.start, turn.end, [b.id, c.id]);
    expect(same.id).toBe(q.id); expect(p.quotes).toHaveLength(1); expect(q.codeIds).toEqual([c.id, b.id]);
    expect(() => setRole(p, t.id, turn.id, 'interviewer')).toThrow(/coded quotes/);
  });
  it('rejects duplicate imports even with changed names or line endings', () => {
    const { t } = fixture(); expect(() => makeTranscript('Different name', t.text.replace(/\r\n/g, '\n'), [t])).toThrow(/already in/);
    expect(() => makeTranscript(t.name.toUpperCase(), 'New text', [t])).toThrow(/name/);
  });
  it('rejects empty, binary, label-only and excessive-turn transcripts', () => {
    for (const raw of ['', '   ', '\0data', 'Participant:', 'x\n'.repeat(20_001)]) expect(() => makeTranscript('Test', raw)).toThrow();
  });
  it('allows honest unassigned lines without invented roles', () => {
    const turns = parseTurns('First line\r\nSecond line'); expect(turns).toHaveLength(2); expect(turns.every(t => t.role === 'unassigned')).toBe(true);
  });
});
describe('code changes', () => {
  it('renames and merges references while preserving quote IDs and descriptions', () => {
    const { p, t, c, turn } = fixture(); const dest = addCode(p, 'Belonging', 'My destination definition');
    const q = assignQuote(p, t.id, turn.id, turn.start, turn.end, [c.id, dest.id]); const original = copy(q);
    renameCode(p, c.id, 'Recognition', c.description); expect(p.quotes[0].codeIds).toContain(c.id);
    mergeCodes(p, c.id, dest.id); expect(p.codes).toHaveLength(1); expect(q.codeIds).toEqual([dest.id]); expect(q.id).toBe(original.id); expect(q.text).toBe(original.text); expect(dest.description).toContain('Merged from Recognition');
    expect(validateProject(p)).toEqual(p);
  });
  it('rejects duplicate names and unsafe self-merges', () => {
    const { p, c } = fixture(); expect(() => addCode(p, 'familiarity')).toThrow(); expect(() => mergeCodes(p, c.id, c.id)).toThrow();
  });
  it('preflights long merged descriptions without mutating either code', () => {
    const p = newProject('Test'); const a = addCode(p, 'A', 'a'.repeat(10_000)); const b = addCode(p, 'B', 'b'.repeat(10_000)); const before = copy(p);
    expect(() => mergeCodes(p, a.id, b.id)).toThrow(/too long/); expect(p).toEqual(before);
  });
});
describe('hostile or corrupt imports', () => {
  for (const [name, corrupt] of Object.entries({
    'interviewer evidence': (p: ReturnType<typeof newProject>): unknown => p.transcripts[0].turns[1].role = 'interviewer',
    'paraphrase': (p: ReturnType<typeof newProject>): unknown => p.quotes[0].text = 'Invented summary',
    'shifted offsets': (p: ReturnType<typeof newProject>): unknown => p.quotes[0].start++,
    'missing code': (p: ReturnType<typeof newProject>): unknown => p.quotes[0].codeIds = ['missing'],
    'duplicate IDs': (p: ReturnType<typeof newProject>): unknown => p.codes[0].id = p.transcripts[0].id,
    'overlapping turns': (p: ReturnType<typeof newProject>): unknown => p.transcripts[0].turns[1].start = 0,
    'generated memo': (p: ReturnType<typeof newProject>): unknown => (p.memos as unknown[]).push({ id: 'm', title: 'x', body: 'x', author: 'model', createdAt: p.createdAt, updatedAt: p.updatedAt }),
  })) it(`rejects ${name}`, () => { const { p, t, c, turn } = fixture(); assignQuote(p, t.id, turn.id, turn.start, turn.end, [c.id]); corrupt(p); expect(() => importProject(JSON.stringify(p))).toThrow(/Invalid project/); });
  it('rejects malformed JSON and unsupported versions', () => { expect(() => importProject('{bad')).toThrow(/not valid/); expect(() => importProject('{"version":99}')).toThrow(/version/); });
  it('uses the same UTF-8 byte ceiling for exports and imports', () => {
    const p = newProject('Large unicode'); for (let i = 0; i < 9; i++) p.transcripts.push(makeTranscript(`Transcript ${i}`, '漢'.repeat(600_000)));
    const raw = JSON.stringify(p); expect(raw.length).toBeLessThan(10_000_000); expect(byteLength(raw)).toBeGreaterThan(16_000_000);
    expect(() => exportProject(p)).toThrow(/16 MB/); expect(() => importProject(raw)).toThrow(/16 MB/);
  });
});
describe('usable exports', () => {
  it('exports one row per quote-code pair, offsets and clearly labeled context', () => {
    const { p, t, c, turn } = fixture(); const b = addCode(p, 'Second'); assignQuote(p, t.id, turn.id, turn.start, turn.end, [c.id, b.id]);
    const csv = quoteCSV(p); expect(csv).toContain('start_utf16'); expect(csv).toContain('Interviewer [interviewer]: Why?'); expect(csv).toContain('participant'); expect(csv).toContain('Second'); expect(codeCSV(p)).toContain('quote_count');
  });
  it('escapes spreadsheet formulas without altering project data', () => {
    const { p } = fixture(); addCode(p, '=HYPERLINK("test")'); expect(codeCSV(p)).toContain("'=HYPERLINK"); expect(p.codes[1].name).toBe('=HYPERLINK("test")');
  });
});

it('maps textarea selections after CRLF to original exact words', () => {
 const source = 'First line\r\nSecond line 🌱\r\nThird line';
 expect(source.slice(sourceOffsetFromTextarea(source,11),sourceOffsetFromTextarea(source,17))).toBe('Second');
 expect(sourceOffsetFromTextarea(source, source.replace(/\r\n/g, '\n').length)).toBe(source.length);
});
it('raw line mode preserves colon prose and label-only text', () => {
 const t = makeTranscript('Raw', 'I was told: wait longer\nParticipant:', [], 'lines');
 expect(t.turns).toHaveLength(2); expect(t.text.slice(t.turns[0].start,t.turns[0].end)).toBe('I was told: wait longer');
});
it('rejects near-limit compact imports whose canonical backup exceeds the cap', () => {
 const p = newProject('Near limit'); for (let i=0; i<17; i++) p.transcripts.push(makeTranscript('Source '+i, 'x'.repeat(940_000)));
 const amount = 15_999_900 - byteLength(JSON.stringify(p)); p.transcripts[16].text += 'x'.repeat(amount); p.transcripts[16].turns[0].end += amount;
 expect(byteLength(JSON.stringify(p))).toBeLessThan(16_000_000); expect(() => importProject(JSON.stringify(p))).toThrow(/16 MB/);
});

it('rejects an expected quotation that disagrees with the frozen source range', () => {
 const {p,t,c,turn}=fixture(); expect(()=>assignQuote(p,t.id,turn.id,turn.start,turn.end,[c.id],'Wrong passage')).toThrow(/no longer match/); expect(p.quotes).toHaveLength(0);
});
it('keeps name validation independent of the host locale', () => {
 const p=newProject('Locale'); addCode(p,'I');addCode(p,'ı');addCode(p,'İ');expect(importProject(exportProject(p))).toEqual(p);
});
it('neutralizes zero-width prefixes before spreadsheet formulas', () => {
 const p=newProject('CSV'); addCode(p,'\u200B=1+1'); expect(codeCSV(p)).toContain("'\u200B=1+1"); expect(p.codes[0].name).toBe('\u200B=1+1');
});
