import { describe, expect, it } from 'vitest';
import { guessRoles, makeTranscript, newProject } from '../src/model';
import { groupKeys } from '../src/guidance';

describe('speaker role guesses', () => {
  it('marks interviewer labels and treats every other speaker as a participant', () => {
    const t = makeTranscript('Synthetic', 'Interviewer: Why?\nP3: It felt familiar.\nQ: Anything else?\nVisitor: No.');
    expect(guessRoles(t.turns).map(x => x.role)).toEqual(['interviewer', 'participant', 'interviewer', 'participant']);
  });
  it('leaves roles unassigned when no interviewer label is recognisable', () => {
    const t = makeTranscript('Synthetic', 'Ana: Why?\nBo: It felt familiar.');
    expect(guessRoles(t.turns).map(x => x.role)).toEqual(['unassigned', 'unassigned']);
  });
  it('reads a bare M as the moderator', () => {
    const t = makeTranscript('Synthetic', 'M: Why?\nP01: It felt familiar.\nAudio: link to example dot com');
    expect(guessRoles(t.turns).map(x => x.role)).toEqual(['interviewer', 'participant', 'participant']);
  });
  it('does not mistake interviewees or respondents for interviewers', () => {
    const t = makeTranscript('Synthetic', 'Moderator 2: Why?\nInterviewee: Because.\nRespondent: Same.');
    expect(guessRoles(t.turns).map(x => x.role)).toEqual(['interviewer', 'participant', 'participant']);
  });
});

describe('group keys', () => {
  const groups = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `g${i}`, title: `G${i}`, color: 0, quoteIds: [], createdAt: '', updatedAt: '' }));
  it('numbers groups 1–9 in board order and never uses 0', () => {
    const keys = groupKeys(newProject('x').id, groups(10), {});
    expect(Object.values(keys)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(keys.g9).toBeUndefined();
  });
  it('honours custom keys and fills the remaining numbers around them', () => {
    expect(groupKeys('p', groups(3), { g1: '1', g2: 'b' })).toEqual({ g0: '2', g1: '1', g2: 'b' });
  });
  it('ignores a custom key that collides with Ungrouped or an earlier group', () => {
    expect(groupKeys('p', groups(2), { g0: '0', g1: 'a' })).toEqual({ g0: '1', g1: 'a' });
    expect(groupKeys('p', groups(2), { g0: 'a', g1: 'a' })).toEqual({ g0: 'a', g1: '1' });
  });
});
