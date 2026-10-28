import type { Role } from './model';

export type Selection = { transcriptId: string; turnId: string; start: number; end: number; text: string };
export const roles: Role[] = ['unassigned', 'participant', 'interviewer'];
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const roleLabel = (r: Role) =>
  r === 'unassigned' ? 'Not assigned' : r === 'participant' ? 'Participant' : 'Interviewer · context only';
