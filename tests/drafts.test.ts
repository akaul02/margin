import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { draftArchive, readDraftRecovery, readDrafts } from '../src/drafts';

let values: Map<string, string>;
const draft = {
  id: 'synthetic-draft',
  projectId: 'synthetic-project',
  kind: 'memo',
  label: 'Unfinished synthetic memo',
  updatedAt: '2026-10-04T03:00:00.000Z',
  data: { title: 'A question', body: 'Human writing, exactly as typed.\nSecond line.' },
};
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
  });
});
afterEach(() => vi.unstubAllGlobals());
function put(suffix: string, value: unknown) {
  values.set('margin-writing-v1:' + suffix, typeof value === 'string' ? value : JSON.stringify(value));
}

it('keeps valid writing accessible beside malformed headers and retains every original byte', () => {
  put('valid', draft);
  put('missing-date', { ...draft, id: 'bad-date', updatedAt: undefined });
  put('object-label', { ...draft, id: 'bad-label', label: { broken: true } });
  put('bad-json', '{damaged');
  const before = new Map(values),
    result = readDraftRecovery('synthetic-project');
  expect(result.damaged).toBe(3);
  expect(result.drafts.map(d => d.data.body)).toEqual([draft.data.body]);
  expect(values).toEqual(before);
  expect(JSON.parse(draftArchive())).toEqual(Object.fromEntries(before));
});
it('quarantines malformed writing and link types without hiding another valid draft', () => {
  put('valid', draft);
  put('bad-body', { ...draft, id: 'bad-body', data: { title: 'A title', body: { broken: true } } });
  put('bad-links', { ...draft, id: 'bad-links', links: 'not-an-array' });
  expect(readDraftRecovery()).toMatchObject({ damaged: 2 });
  expect(readDrafts()).toHaveLength(1);
});
it('keeps incomplete legacy writing and selects only the newest valid generation', () => {
  put('legacy', { ...draft, data: { title: '', body: 'Unfinished title is allowed.' } });
  put('old', { ...draft, id: 'another', generation: 1 });
  put('new', { ...draft, id: 'another', generation: 2, data: { title: 'Still writing', body: 'Newer words' } });
  const result = readDraftRecovery();
  expect(result.damaged).toBe(0);
  expect(result.drafts).toHaveLength(2);
  expect(result.drafts.find(d => d.id === 'another')?.data.body).toBe('Newer words');
});
it('scopes draft IDs by project and does not attribute another project’s damaged draft to this one', () => {
  put('one', draft);
  put('two', { ...draft, projectId: 'second-project' });
  put('other-damage', { ...draft, projectId: 'second-project', label: { broken: true } });
  expect(readDrafts()).toHaveLength(2);
  expect(readDraftRecovery('synthetic-project')).toMatchObject({ damaged: 0 });
  expect(readDrafts('synthetic-project')).toHaveLength(1);
});
