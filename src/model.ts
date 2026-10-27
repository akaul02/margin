import type { Operation } from '../shared/operations.mjs';
export type Role = 'participant' | 'interviewer' | 'unassigned';
export type Turn = { id: string; label: string; role: Role; start: number; end: number };
export type Transcript = { id: string; name: string; text: string; turns: Turn[]; createdAt: string };
export type Code = {
  id: string;
  name: string;
  description: string;
  color: number;
  inclusion: string;
  exclusion: string;
  exampleQuoteIds: string[];
};
export type Quote = {
  id: string;
  transcriptId: string;
  turnId: string;
  start: number;
  end: number;
  text: string;
  codeIds: string[];
  createdAt: string;
};
export type Memo = { id: string; title: string; body: string; author: 'user'; createdAt: string; updatedAt: string; quoteIds: string[] };
export type ThemeGroup = {
  id: string;
  title: string;
  body: string;
  author: 'user';
  kind: 'group' | 'theme';
  codeIds: string[];
  quoteIds: string[];
  createdAt: string;
  updatedAt: string;
};
/** `note` is an optional description shown when the column header is opened; `noteIds` orders the board notes filed in it. */
export type BoardGroup = { id: string; title: string; note?: string; color: number; quoteIds: string[]; noteIds?: string[]; createdAt: string; updatedAt: string };
/** A researcher's own sticky note on the board: interpretation beside the quotes, never evidence. */
export type BoardNote = { id: string; text: string; by: string; author: 'user'; createdAt: string; updatedAt: string };
export type BoardComment = { id: string; quoteId: string; by: string; body: string; author: 'user'; createdAt: string; updatedAt: string };
export type Project = {
  format: 'ceal-margin';
  version: 3;
  id: string;
  name: string;
  synthetic: boolean;
  createdAt: string;
  updatedAt: string;
  transcripts: Transcript[];
  codes: Code[];
  quotes: Quote[];
  memos: Memo[];
  themes: ThemeGroup[];
  boardGroups: BoardGroup[];
  comments: BoardComment[];
  boardNotes: BoardNote[];
};
export type QuarantinedProject = { raw: unknown; reason: string };
export type SharedConnection = {
  roomId: string;
  revision: string;
  dirty: boolean;
  pending?: Operation[];
  creating?: Project;
  conflict?: { operationId: string; reason: string; remote: Project; revision: string };
};
export type Workspace = {
  projects: Project[];
  activeId: string | null;
  revision: string;
  quarantined?: QuarantinedProject[];
  connections?: Record<string, SharedConnection>;
};
export const MAX_TEXT = 1_000_000;
export const MAX_PROJECT = 16_000_000;
export const MAX_NOTE = 5_000;
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const copy = <T>(v: T): T => structuredClone(v);
export function newProject(name: string, synthetic = false): Project {
  const date = now();
  return {
    format: 'ceal-margin',
    version: 3,
    id: uid(),
    name: required(name, 'Project name', 120),
    synthetic,
    createdAt: date,
    updatedAt: date,
    transcripts: [],
    codes: [],
    quotes: [],
    memos: [],
    themes: [],
    boardGroups: [],
    comments: [],
    boardNotes: [],
  };
}
export function required(value: string, label: string, max = 120): string {
  if (!value.trim()) throw new Error(`${label} cannot be empty.`);
  if (value.trim().length > max) throw new Error(`${label} is too long (maximum ${max} characters).`);
  return value.trim();
}
/** Text never changes. Every range uses JavaScript UTF-16 offsets, end-exclusive. */
export function parseTurns(text: string, mode: 'labels' | 'lines' = 'labels'): Turn[] {
  const labels = mode === 'lines' ? [] : [...text.matchAll(/^([^\r\n:]{1,60}):[ \t]*/gm)];
  const turns: Turn[] = [];
  const add = (start: number, end: number, label: string) => {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start < end) turns.push({ id: uid(), label, role: 'unassigned', start, end });
  };
  const unlabeled = (start: number, end: number) => {
    const chunk = text.slice(start, end);
    for (const match of chunk.matchAll(/[^\r\n]+/g)) add(start + match.index!, start + match.index! + match[0].length, 'Unlabeled');
  };
  if (!labels.length) unlabeled(0, text.length);
  else {
    unlabeled(0, labels[0].index!);
    labels.forEach((m, i) => add(m.index! + m[0].length, labels[i + 1]?.index ?? text.length, m[1].trim()));
  }
  return turns;
}
export function makeTranscript(name: string, text: string, existing: Transcript[] = [], mode: 'labels' | 'lines' = 'labels'): Transcript {
  required(name, 'Transcript name');
  if (!text.trim()) throw new Error('Add some transcript text first.');
  if (text.length > MAX_TEXT) throw new Error('This transcript is too large. Use at most 1 million characters per transcript.');
  if (text.includes('\0')) throw new Error('This file contains binary data. Use a UTF-8 plain text (.txt) file.');
  if (existing.some(t => t.text.replace(/\r\n/g, '\n').trim() === text.replace(/\r\n/g, '\n').trim()))
    throw new Error('This transcript is already in this project. No duplicate was added.');
  if (existing.some(t => t.name.toLowerCase() === name.trim().toLowerCase()))
    throw new Error('A transcript already has that name. Choose a different name.');
  const turns = parseTurns(text, mode);
  if (!turns.length) throw new Error('No spoken text was found. Add words after the speaker labels.');
  if (turns.length > 20_000) throw new Error('A transcript can contain at most 20,000 turns. Split this transcript into smaller sources.');
  return { id: uid(), name: name.trim(), text, turns, createdAt: now() };
}
/** Pre-fill roles from common interviewer labels. The reader still confirms every role before import. */
const interviewerLabel = /^(interviewer|moderator|facilitator|researcher|int|mod|m|q)(\s*\d+)?\.?$/i;
export const isInterviewerLabel = (label: string) => interviewerLabel.test(label.trim());
/** How a turn's role reads next to its speaker label. Non-speaker context (audio, notes) is just context. */
export const turnRoleLabel = (t: Turn) =>
  t.role === 'participant'
    ? 'Participant'
    : t.role === 'unassigned'
      ? 'Not assigned · context only'
      : isInterviewerLabel(t.label)
        ? 'Interviewer · context only'
        : 'Context only';
export function guessRoles(turns: Turn[]): Turn[] {
  if (!turns.some(t => interviewerLabel.test(t.label.trim()))) return turns;
  return turns.map(t =>
    t.role !== 'unassigned' ? t : { ...t, role: interviewerLabel.test(t.label.trim()) ? 'interviewer' : 'participant' },
  );
}
export function addCode(p: Project, name: string, description = '', color = p.codes.length % 6): Code {
  name = required(name, 'Code name', 80);
  if (description.length > 20_000) throw new Error('Code descriptions can contain at most 20,000 characters.');
  if (p.codes.some(c => c.name.toLowerCase() === name.toLowerCase())) throw new Error('A code with that name already exists.');
  const code = { id: uid(), name, description, color, inclusion: '', exclusion: '', exampleQuoteIds: [] as string[] };
  p.codes.push(code);
  return code;
}
export function renameCode(p: Project, id: string, name: string, description: string) {
  name = required(name, 'Code name', 80);
  if (description.length > 20_000) throw new Error('Code descriptions can contain at most 20,000 characters.');
  if (p.codes.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase()))
    throw new Error('A code with that name already exists. Merge the codes instead.');
  const code = p.codes.find(c => c.id === id);
  if (!code) throw new Error('This code no longer exists.');
  code.name = name;
  code.description = description;
}
export function mergeCodes(p: Project, from: string, into: string) {
  if (from === into || !p.codes.some(c => c.id === from) || !p.codes.some(c => c.id === into))
    throw new Error('Choose two different existing codes.');
  const source = p.codes.find(c => c.id === from)!;
  const target = p.codes.find(c => c.id === into)!;
  const description = source.description
    ? [target.description, `Merged from ${source.name}: ${source.description}`].filter(Boolean).join('\n\n')
    : target.description;
  if (description.length > 20_000)
    throw new Error(
      'The combined description is too long (20,000 characters maximum). Shorten a description before merging. Both codes are unchanged.',
    );
  const guidance = (key: 'inclusion' | 'exclusion') =>
    [target[key], source[key] && `Merged from ${source.name}: ${source[key]}`].filter(Boolean).join('\n\n');
  const inclusion = guidance('inclusion'),
    exclusion = guidance('exclusion');
  if (inclusion.length > 20_000 || exclusion.length > 20_000)
    throw new Error('Combined guidance exceeds 20,000 characters. Shorten it before merging. Both codes are unchanged.');
  for (const group of p.themes) group.codeIds = [...new Set(group.codeIds.map(id => (id === from ? into : id)))];
  target.inclusion = inclusion;
  target.exclusion = exclusion;
  target.exampleQuoteIds = [...new Set([...target.exampleQuoteIds, ...source.exampleQuoteIds])];
  for (const q of p.quotes) q.codeIds = [...new Set(q.codeIds.map(id => (id === from ? into : id)))];
  target.description = description;
  p.codes = p.codes.filter(c => c.id !== from);
}
export function assignQuote(
  p: Project,
  transcriptId: string,
  turnId: string,
  start: number,
  end: number,
  codeIds: string[],
  expectedText?: string,
  allowUncoded = false,
): Quote {
  const t = p.transcripts.find(t => t.id === transcriptId);
  const turn = t?.turns.find(t => t.id === turnId);
  if (!t || !turn || turn.role !== 'participant') throw new Error('Only a confirmed participant turn can be coded.');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < turn.start ||
    end > turn.end ||
    start >= end ||
    !t.text.slice(start, end).trim()
  )
    throw new Error('Select an exact passage within one participant turn.');
  if (expectedText !== undefined && t.text.slice(start, end) !== expectedText)
    throw new Error('The selected words no longer match this source range. Select the passage again.');
  if ((!allowUncoded && !codeIds.length) || codeIds.some(id => !p.codes.some(c => c.id === id)))
    throw new Error('Choose at least one existing code.');
  const existing = p.quotes.find(q => q.transcriptId === transcriptId && q.start === start && q.end === end);
  if (existing) {
    existing.codeIds = [...new Set([...existing.codeIds, ...codeIds])];
    return existing;
  }
  const quote = {
    id: uid(),
    transcriptId,
    turnId,
    start,
    end,
    text: t.text.slice(start, end),
    codeIds: [...new Set(codeIds)],
    createdAt: now(),
  };
  p.quotes.push(quote);
  return quote;
}
export function setRole(p: Project, transcriptId: string, turnId: string, role: Role) {
  const turn = p.transcripts.find(t => t.id === transcriptId)?.turns.find(t => t.id === turnId);
  if (!turn) throw new Error('Turn not found.');
  if (role !== 'participant' && p.quotes.some(q => q.turnId === turnId))
    throw new Error(
      'This turn has coded quotes. Remove those quotes in the quote library before changing its role. You can undo quote removal.',
    );
  turn.role = role;
}
const invalid = (detail: string): never => {
  throw new Error(`Invalid project: ${detail}. Your existing work was not changed.`);
};
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
/** Validate the entire evidence graph before either import or storage restore. */
export function validateProject(value: unknown): Project {
  if (!obj(value) || value.format !== 'ceal-margin' || ![1, 2, 3].includes(value.version as number))
    invalid('unsupported format or version (expected Margin version 1, 2 or 3)');
  // Work on a copy: migration never changes its input or any source text / IDs.
  const migrated = copy(value) as Record<string, unknown>;
  if (migrated.version === 1) {
    migrated.themes = [];
    if (Array.isArray(migrated.codes))
      migrated.codes = migrated.codes.map(c => (obj(c) ? { ...c, inclusion: '', exclusion: '', exampleQuoteIds: [] } : c));
    if (Array.isArray(migrated.memos)) migrated.memos = migrated.memos.map(m => (obj(m) ? { ...m, quoteIds: [] } : m));
  }
  if (migrated.version !== 3) {
    if (migrated.boardGroups === undefined) migrated.boardGroups = [];
    if (migrated.comments === undefined) migrated.comments = [];
    migrated.version = 3;
  }
  if (migrated.boardNotes === undefined) migrated.boardNotes = [];
  const p = migrated as unknown as Project;
  if (!id(p.id) || !str(p.name, 120) || !p.name.trim() || typeof p.synthetic !== 'boolean' || !date(p.createdAt) || !date(p.updatedAt))
    invalid('project details are missing');
  const groups = [p.transcripts, p.codes, p.quotes, p.memos, p.themes, p.boardGroups, p.comments, p.boardNotes];
  if (groups.some(g => !Array.isArray(g) || g.length > 20_000)) invalid('project lists are missing or too large');
  const seen = new Set<string>();
  const unique = (v: unknown) => {
    if (!id(v) || seen.has(v)) invalid('missing or duplicate reference IDs');
    seen.add(v as string);
  };
  unique(p.id);
  const transcriptNames = new Set<string>();
  const codeNames = new Set<string>();
  for (const t of p.transcripts) {
    if (
      !obj(t) ||
      !str(t.name, 120) ||
      !t.name.trim() ||
      !str(t.text) ||
      !t.text.trim() ||
      t.text.includes('\0') ||
      !date(t.createdAt) ||
      !Array.isArray(t.turns) ||
      !t.turns.length ||
      t.turns.length > 20_000
    )
      invalid('malformed transcript');
    unique(t.id);
    if (transcriptNames.has(t.name.toLowerCase())) invalid('duplicate transcript names');
    transcriptNames.add(t.name.toLowerCase());
    let lastEnd = 0;
    for (const turn of t.turns) {
      if (
        !obj(turn) ||
        !str(turn.label, 100) ||
        !['participant', 'interviewer', 'unassigned'].includes(turn.role) ||
        !int(turn.start) ||
        !int(turn.end) ||
        turn.start < lastEnd ||
        turn.end <= turn.start ||
        turn.end > t.text.length
      )
        invalid('malformed or overlapping turn ranges');
      unique(turn.id);
      lastEnd = turn.end;
    }
  }
  for (const c of p.codes) {
    if (
      !obj(c) ||
      !str(c.name, 80) ||
      !c.name.trim() ||
      !str(c.description, 20_000) ||
      !str(c.inclusion, 20_000) ||
      !str(c.exclusion, 20_000) ||
      !Array.isArray(c.exampleQuoteIds) ||
      !int(c.color) ||
      c.color < 0 ||
      c.color > 5
    )
      invalid('malformed code');
    unique(c.id);
    if (codeNames.has(c.name.toLowerCase())) invalid('duplicate code names');
    codeNames.add(c.name.toLowerCase());
  }
  const spans = new Set<string>();
  for (const q of p.quotes) {
    if (
      !obj(q) ||
      !int(q.start) ||
      !int(q.end) ||
      !str(q.text) ||
      !date(q.createdAt) ||
      !Array.isArray(q.codeIds) ||
      q.codeIds.length > 20_000 ||
      new Set(q.codeIds).size !== q.codeIds.length
    )
      invalid('malformed quote');
    unique(q.id);
    const t = p.transcripts.find(t => t.id === q.transcriptId);
    const turn = t?.turns.find(t => t.id === q.turnId);
    if (
      !t ||
      !turn ||
      turn.role !== 'participant' ||
      q.start < turn.start ||
      q.end > turn.end ||
      q.start >= q.end ||
      !q.text.trim() ||
      t.text.slice(q.start, q.end) !== q.text ||
      q.codeIds.some(id => !p.codes.some(c => c.id === id))
    )
      invalid('quote does not match a participant source passage or code');
    const key = `${q.transcriptId}:${q.start}:${q.end}`;
    if (spans.has(key)) invalid('duplicate quote ranges');
    spans.add(key);
  }
  const references = (refs: unknown, available: { id: string }[]) =>
    Array.isArray(refs) &&
    refs.length <= 20_000 &&
    refs.every(x => typeof x === 'string' && available.some(a => a.id === x)) &&
    new Set(refs).size === refs.length;
  for (const c of p.codes)
    if (!references(c.exampleQuoteIds, p.quotes) || c.exampleQuoteIds.some(id => !p.quotes.find(q => q.id === id)!.codeIds.includes(c.id)))
      invalid('code example must reference a quote carrying that code');
  for (const group of p.themes) {
    if (
      !obj(group) ||
      !str(group.title, 120) ||
      !group.title.trim() ||
      !str(group.body, 100_000) ||
      group.author !== 'user' ||
      !['group', 'theme'].includes(group.kind) ||
      !date(group.createdAt) ||
      !date(group.updatedAt) ||
      !references(group.codeIds, p.codes) ||
      !references(group.quoteIds, p.quotes)
    )
      invalid('malformed user-authored grouping or theme');
    unique(group.id);
  }
  for (const n of p.boardNotes) {
    if (
      !obj(n) ||
      !str(n.text, MAX_NOTE) ||
      !n.text.trim() ||
      !str(n.by, 80) ||
      n.author !== 'user' ||
      !date(n.createdAt) ||
      !date(n.updatedAt)
    )
      invalid('malformed user-authored board note');
    unique(n.id);
  }
  const boardQuotes = new Set<string>();
  const boardNotes = new Set<string>();
  for (const group of p.boardGroups) {
    if (
      !obj(group) ||
      !str(group.title, 120) ||
      !group.title.trim() ||
      (group.note !== undefined && !str(group.note, 100_000)) ||
      !int(group.color) ||
      group.color < 0 ||
      group.color > 5 ||
      !date(group.createdAt) ||
      !date(group.updatedAt) ||
      !references(group.quoteIds, p.quotes) ||
      (group.noteIds !== undefined && !references(group.noteIds, p.boardNotes))
    )
      invalid('malformed board group');
    unique(group.id);
    for (const quoteId of group.quoteIds) {
      if (boardQuotes.has(quoteId)) invalid('a quote card cannot occupy two board groups');
      boardQuotes.add(quoteId);
    }
    for (const noteId of group.noteIds ?? []) {
      if (boardNotes.has(noteId)) invalid('a board note cannot sit in two board groups');
      boardNotes.add(noteId);
    }
  }
  for (const comment of p.comments) {
    if (
      !obj(comment) ||
      !str(comment.by, 80) ||
      !comment.by.trim() ||
      !str(comment.body, 20_000) ||
      !comment.body.trim() ||
      comment.author !== 'user' ||
      !date(comment.createdAt) ||
      !date(comment.updatedAt) ||
      !p.quotes.some(q => q.id === comment.quoteId)
    )
      invalid('malformed user-authored card comment');
    unique(comment.id);
  }
  for (const m of p.memos) {
    if (
      !obj(m) ||
      !str(m.title, 120) ||
      !m.title.trim() ||
      !str(m.body, 100_000) ||
      m.author !== 'user' ||
      !date(m.createdAt) ||
      !date(m.updatedAt) ||
      !references(m.quoteIds, p.quotes)
    )
      invalid('malformed user-authored memo');
    unique(m.id);
  }
  return copy(p);
}
export function importProject(raw: string): Project {
  if (byteLength(raw) > MAX_PROJECT) throw new Error('Project file is too large (16 MB maximum).');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This is not valid project JSON. Choose a .margin.json backup.');
  }
  if (obj(value) && value.version === 1 && byteLength(JSON.stringify(value, null, 2)) > 10_000_000)
    throw new Error('Version 1 projects have a 10 MB backup limit.');
  const project = validateProject(value);
  exportProject(project);
  return project;
}
export const exportProject = (p: Project) => {
  const json = JSON.stringify(validateProject(p), null, 2);
  if (byteLength(json) > MAX_PROJECT)
    throw new Error('This project exceeds the 16 MB backup limit. Use separate projects for more transcripts.');
  return json;
};
// Prefix spreadsheet formulas; quote every field so separators and line breaks survive.
const csvCell = (value: unknown) => {
  let s = String(value ?? '');
  if (/^[\s\u200B-\u200D\u2060]*[=+@-]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
export function quoteCSV(p: Project) {
  const rows: unknown[][] = [
    [
      'quote_id',
      'transcript_id',
      'transcript',
      'turn_id',
      'speaker',
      'role',
      'start_utf16',
      'end_utf16_exclusive',
      'exact_quote',
      'code_id',
      'code',
      'context_before',
      'context_after',
      'synthetic',
    ],
  ];
  for (const q of p.quotes) {
    const t = p.transcripts.find(t => t.id === q.transcriptId)!;
    const n = t.turns.findIndex(t => t.id === q.turnId);
    const turn = t.turns[n];
    const context = (i: number) => {
      const x = t.turns[i];
      return x ? `${x.label} [${x.role}]: ${t.text.slice(x.start, x.end)}` : '';
    };
    for (const codeId of q.codeIds.length ? q.codeIds : [''])
      rows.push([
        q.id,
        t.id,
        t.name,
        q.turnId,
        turn.label,
        'participant',
        q.start,
        q.end,
        q.text,
        codeId,
        p.codes.find(c => c.id === codeId)?.name ?? '',
        context(n - 1),
        context(n + 1),
        p.synthetic,
      ]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function codeCSV(p: Project) {
  return (
    '\uFEFF' +
    [
      ['code_id', 'name', 'description', 'include_when', 'exclude_when', 'example_quote_ids', 'quote_count'],
      ...p.codes.map(c => [
        c.id,
        c.name,
        c.description,
        c.inclusion,
        c.exclusion,
        c.exampleQuoteIds.join(';'),
        p.quotes.filter(q => q.codeIds.includes(c.id)).length,
      ]),
    ]
      .map(r => r.map(csvCell).join(','))
      .join('\r\n')
  );
}
export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
/** Textareas normalize CRLF to LF. Map their UTF-16 positions back to untouched source. */
export function sourceOffsetFromTextarea(source: string, offset: number): number {
  let original = 0;
  let displayed = 0;
  while (original < source.length && displayed < offset) {
    original += source[original] === '\r' && source[original + 1] === '\n' ? 2 : 1;
    displayed++;
  }
  return original;
}
export async function readTextFile(file: File, maxBytes: number) {
  if (file.size > maxBytes) throw new Error(`File is too large (${Math.round(maxBytes / 1_000_000)} MB maximum).`);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('Could not read this file as UTF-8 text. Save it as a UTF-8 .txt file and try again.');
  }
}

/** Removing evidence also removes references to it, never researcher-authored prose. */
export function removeQuote(p: Project, quoteId: string) {
  p.quotes = p.quotes.filter(q => q.id !== quoteId);
  p.comments = p.comments.filter(c => c.quoteId !== quoteId);
  for (const group of p.boardGroups) group.quoteIds = group.quoteIds.filter(id => id !== quoteId);
  for (const c of p.codes) c.exampleQuoteIds = c.exampleQuoteIds.filter(id => id !== quoteId);
  for (const group of p.themes) group.quoteIds = group.quoteIds.filter(id => id !== quoteId);
  for (const memo of p.memos) memo.quoteIds = memo.quoteIds.filter(id => id !== quoteId);
}
export function renameProject(p: Project, name: string) {
  p.name = required(name, 'Project name', 120);
}
export function renameTranscript(p: Project, id: string, name: string) {
  name = required(name, 'Transcript name', 120);
  if (p.transcripts.some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase()))
    throw new Error('A transcript already has that name. Choose a different name.');
  const t = p.transcripts.find(t => t.id === id);
  if (!t) throw new Error('This transcript no longer exists.');
  t.name = name;
}
/** Removing a source removes every quote card taken from it, with that card's notes and links. */
export function removeTranscript(p: Project, id: string) {
  if (!p.transcripts.some(t => t.id === id)) throw new Error('This transcript no longer exists.');
  for (const q of p.quotes.filter(q => q.transcriptId === id)) removeQuote(p, q.id);
  p.transcripts = p.transcripts.filter(t => t.id !== id);
}
/** Quotes keep their cards; only the label goes. */
export function removeCode(p: Project, id: string) {
  if (!p.codes.some(c => c.id === id)) throw new Error('This code no longer exists.');
  for (const q of p.quotes) q.codeIds = q.codeIds.filter(x => x !== id);
  for (const t of p.themes) t.codeIds = t.codeIds.filter(x => x !== id);
  p.codes = p.codes.filter(c => c.id !== id);
}
export function removeMemo(p: Project, id: string) {
  if (!p.memos.some(m => m.id === id)) throw new Error('This memo no longer exists.');
  p.memos = p.memos.filter(m => m.id !== id);
}
/** Board order is array order. Local live sessions sync group contents, not their order. */
export function moveGroup(p: Project, id: string, by: -1 | 1) {
  const i = p.boardGroups.findIndex(g => g.id === id);
  if (i < 0) throw new Error('This board group no longer exists.');
  const j = i + by;
  if (j < 0 || j >= p.boardGroups.length) return;
  [p.boardGroups[i], p.boardGroups[j]] = [p.boardGroups[j], p.boardGroups[i]];
}
/** Speaker labels are local to one source; this never infers cross-source identities. */
export function coverageRows(p: Project) {
  return p.transcripts.flatMap(t =>
    [...new Set(t.turns.filter(x => x.role === 'participant').map(x => x.label))].map(label => ({
      transcriptId: t.id,
      transcript: t.name,
      speaker: label,
      counts: Object.fromEntries(
        p.codes.map(c => [
          c.id,
          p.quotes.filter(q => q.transcriptId === t.id && t.turns.find(x => x.id === q.turnId)?.label === label && q.codeIds.includes(c.id))
            .length,
        ]),
      ),
    })),
  );
}
export function themeCSV(p: Project) {
  const rows = [
    ['group_id', 'kind', 'title', 'researcher_note', 'author', 'code_ids', 'quote_ids'],
    ...p.themes.map(t => [t.id, t.kind, t.title, t.body, t.author, t.codeIds.join(';'), t.quoteIds.join(';')]),
  ];
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
export function coverageCSV(p: Project) {
  const rows = [
    ['source_id', 'source', 'speaker_label_in_source', ...p.codes.map(c => `${c.name} [${c.id}]`)],
    ...coverageRows(p).map(r => [r.transcriptId, r.transcript, r.speaker, ...p.codes.map(c => r.counts[c.id])]),
  ];
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** A sticky-note quote needs no code or interpretation, only verified participant provenance. */
export function saveQuoteCard(p: Project, transcriptId: string, turnId: string, start: number, end: number, expectedText: string) {
  return assignQuote(p, transcriptId, turnId, start, end, [], expectedText, true);
}
export function moveCard(p: Project, quoteId: string, groupId: string | null, beforeQuoteId?: string) {
  if (!p.quotes.some(q => q.id === quoteId)) throw new Error('This quote card no longer exists.');
  const target = groupId ? p.boardGroups.find(g => g.id === groupId) : null;
  if (groupId && !target) throw new Error('This board group no longer exists.');
  for (const group of p.boardGroups) group.quoteIds = group.quoteIds.filter(id => id !== quoteId);
  if (target) {
    const index = beforeQuoteId ? target.quoteIds.indexOf(beforeQuoteId) : -1;
    if (index >= 0) target.quoteIds.splice(index, 0, quoteId);
    else target.quoteIds.push(quoteId);
    target.updatedAt = now();
  }
}
function noteText(text: string) {
  const body = text.trim();
  if (!body) throw new Error('Write something in the note first.');
  if (body.length > MAX_NOTE) throw new Error(`A note can be up to ${MAX_NOTE.toLocaleString()} characters.`);
  return body;
}
function unfileNote(p: Project, noteId: string) {
  for (const g of p.boardGroups) {
    if (!g.noteIds?.includes(noteId)) continue;
    g.noteIds = g.noteIds.filter(id => id !== noteId);
    if (!g.noteIds.length) delete g.noteIds;
  }
}
/** A new note goes on top of its group's notes, or stays ungrouped when no group is given. */
export function addBoardNote(p: Project, groupId: string | null, text: string, by = ''): BoardNote {
  const target = groupId ? p.boardGroups.find(g => g.id === groupId) : null;
  if (groupId && !target) throw new Error('This board group no longer exists.');
  const date = now();
  const note: BoardNote = { id: uid(), text: noteText(text), by: by.trim().slice(0, 80), author: 'user', createdAt: date, updatedAt: date };
  p.boardNotes.push(note);
  if (target) {
    target.noteIds = [note.id, ...(target.noteIds ?? [])];
    target.updatedAt = date;
  }
  return note;
}
export function editBoardNote(p: Project, id: string, text: string) {
  const note = p.boardNotes.find(n => n.id === id);
  if (!note) throw new Error('This note no longer exists.');
  note.text = noteText(text);
  note.updatedAt = now();
}
export function removeBoardNote(p: Project, id: string) {
  if (!p.boardNotes.some(n => n.id === id)) throw new Error('This note no longer exists.');
  unfileNote(p, id);
  p.boardNotes = p.boardNotes.filter(n => n.id !== id);
}
export function moveBoardNote(p: Project, noteId: string, groupId: string | null, beforeNoteId?: string) {
  if (!p.boardNotes.some(n => n.id === noteId)) throw new Error('This note no longer exists.');
  const target = groupId ? p.boardGroups.find(g => g.id === groupId) : null;
  if (groupId && !target) throw new Error('This board group no longer exists.');
  unfileNote(p, noteId);
  if (target) {
    const ids = target.noteIds ?? [];
    const index = beforeNoteId ? ids.indexOf(beforeNoteId) : -1;
    if (index >= 0) ids.splice(index, 0, noteId);
    else ids.push(noteId);
    target.noteIds = ids;
    target.updatedAt = now();
  }
}
export function boardCSV(p: Project) {
  const rows = [
    [
      'quote_id',
      'group_id',
      'group_name',
      'source_id',
      'source_name',
      'speaker',
      'start_utf16',
      'end_utf16_exclusive',
      'exact_quote',
      'comment_count',
      'synthetic',
    ],
    ...p.quotes.map(q => {
      const group = p.boardGroups.find(g => g.quoteIds.includes(q.id));
      const t = p.transcripts.find(t => t.id === q.transcriptId)!;
      return [
        q.id,
        group?.id ?? '',
        group?.title ?? 'Ungrouped',
        t.id,
        t.name,
        t.turns.find(t => t.id === q.turnId)!.label,
        q.start,
        q.end,
        q.text,
        p.comments.filter(c => c.quoteId === q.id).length,
        p.synthetic,
      ];
    }),
  ];
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
export function commentsCSV(p: Project) {
  return (
    '\uFEFF' +
    [
      ['comment_id', 'quote_id', 'self_entered_name', 'comment_text', 'author', 'created_at', 'updated_at'],
      ...p.comments.map(c => [c.id, c.quoteId, c.by, c.body, c.author, c.createdAt, c.updatedAt]),
    ]
      .map(r => r.map(csvCell).join(','))
      .join('\r\n')
  );
}
