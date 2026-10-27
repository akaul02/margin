import { useWorkspaceServices } from './WorkspaceContext';
import { useRef, useState, useEffect } from 'react';
import { equal } from '../shared/operations.mjs';
import { uid, now } from './model';

export type DraftKind = 'note' | 'memo' | 'comparison' | 'group' | 'code' | 'theme';
export type Draft = {
  id: string;
  generation?: number;
  storageKey?: string;
  projectId: string;
  kind: DraftKind;
  label: string;
  updatedAt: string;
  entityId?: string;
  quoteId?: string;
  base?: any;
  links?: string[];
  data: Record<string, any>;
};
const prefixFor = (namespace = '') => (namespace ? `margin-account-writing-v1:${encodeURIComponent(namespace)}:` : 'margin-writing-v1:');
const changed = () => window.dispatchEvent(new Event('margin-drafts-changed'));
const writingFields: Record<DraftKind, string[]> = {
  note: ['by', 'body'],
  memo: ['title', 'body'],
  comparison: ['title', 'body'],
  group: ['title'],
  code: ['name', 'description', 'inclusion', 'exclusion'],
  theme: ['title', 'body', 'kind'],
};
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 100;
function validDraft(value: unknown): value is Draft {
  if (
    !record(value) ||
    !identifier(value.id) ||
    !identifier(value.projectId) ||
    typeof value.label !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !record(value.data)
  )
    return false;
  if (typeof value.kind !== 'string' || !Object.hasOwn(writingFields, value.kind)) return false;
  if (value.generation !== undefined && (!Number.isSafeInteger(value.generation) || value.generation < 0)) return false;
  if (['entityId', 'quoteId'].some(key => value[key] !== undefined && !identifier(value[key]))) return false;
  if (value.links !== undefined && (!Array.isArray(value.links) || !value.links.every(identifier))) return false;
  if (!writingFields[value.kind as DraftKind].every(key => typeof value.data[key] === 'string')) return false;
  if (
    ['quoteIds', 'codeIds', 'exampleQuoteIds'].some(
      key => value.data[key] !== undefined && (!Array.isArray(value.data[key]) || !value.data[key].every(identifier)),
    )
  )
    return false;
  if (value.kind === 'note' && !identifier(value.quoteId)) return false;
  if (value.kind === 'group' && (!Number.isInteger(value.data.color) || value.data.color < 0 || value.data.color > 5)) return false;
  if (value.kind === 'theme' && !['group', 'theme'].includes(value.data.kind)) return false;
  return true;
}
export function readDraftRecovery(projectId?: string, namespace = ''): { drafts: Draft[]; damaged: number } {
  const prefix = prefixFor(namespace);
  const records: Draft[] = [];
  let damaged = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    // Damage in one draft must not hide valid writing or crash its review UI.
    // Leave the original bytes untouched for the raw recovery download.
    try {
      const d = JSON.parse(raw);
      if (projectId && typeof d?.projectId === 'string' && d.projectId !== projectId) continue;
      if (validDraft(d)) records.push({ ...d, storageKey: key });
      else damaged++;
    } catch {
      damaged++;
    }
  }
  const latest = new Map<string, Draft>();
  for (const d of records) {
    const key = JSON.stringify([d.projectId, d.id]),
      old = latest.get(key);
    if (!old || (d.generation ?? 0) > (old.generation ?? 0)) latest.set(key, d);
  }
  return { drafts: [...latest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), damaged };
}
export function readDrafts(projectId?: string, namespace = ''): Draft[] {
  return readDraftRecovery(projectId, namespace).drafts;
}
export function draftArchive(namespace = ''): string {
  const prefix = prefixFor(namespace);
  const records: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) records[key] = localStorage.getItem(key);
  }
  return JSON.stringify(records, null, 2);
}
/** Remove every stored draft generation that belongs to a deleted project, within one account's drafts. */
export function removeProjectDrafts(projectId: string, namespace = '') {
  const prefix = prefixFor(namespace),
    keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      if (JSON.parse(localStorage.getItem(key) ?? '')?.projectId === projectId) keys.push(key);
    } catch {
      /* Damaged drafts without a readable project stay for raw recovery. */
    }
  }
  keys.forEach(k => localStorage.removeItem(k));
  if (keys.length) changed();
}
export function removeDraft(draft: Pick<Draft, 'id' | 'storageKey'>, namespace = '') {
  const prefix = prefixFor(namespace),
    key = draft.storageKey ?? prefix + draft.id;
  if (!key.startsWith(prefix)) throw new Error('This draft belongs to another account.');
  localStorage.removeItem(key);
  changed();
}
export function useDurableDraft<T extends Record<string, any>>(scope: Omit<Draft, 'id' | 'data' | 'updatedAt'>, initial: T) {
  const { namespace } = useWorkspaceServices();
  const prefix = prefixFor(namespace);
  const initialRef = useRef(initial),
    id = useRef(uid()),
    scopeRef = useRef(scope);
  const [value, setValue] = useState(initial),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const current = useRef(initial),
    storageKey = useRef<string | undefined>(undefined),
    generation = useRef(0);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!equal(current.current, initialRef.current)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);
  function update(next: T) {
    current.current = next;
    setValue(next);
    try {
      if (equal(next, initialRef.current)) {
        removeDraft({ id: id.current, storageKey: storageKey.current }, namespace);
        storageKey.current = undefined;
        setSaved(false);
      } else {
        // Immutable generation keys prevent recovery in another tab from
        // removing writing typed after the generation that it submitted.
        const key = prefix + id.current + ':' + uid(),
          number = ++generation.current;
        localStorage.setItem(
          key,
          JSON.stringify({ ...scopeRef.current, id: id.current, generation: number, updatedAt: now(), data: next }),
        );
        const previous = storageKey.current;
        storageKey.current = key;
        if (previous) localStorage.removeItem(previous);
        setSaved(true);
        changed();
      }
      setError('');
    } catch {
      setSaved(false);
      setError('This draft could not be stored on this device. Keep this window open and copy or download your writing before leaving.');
    }
  }
  function clear(submitted: T = current.current) {
    // A slow submit must not clear newer typing. Editors also disable inputs
    // while submitting, but the generation check protects programmatic changes.
    if (!equal(current.current, submitted)) return false;
    try {
      removeDraft({ id: id.current, storageKey: storageKey.current }, namespace);
      storageKey.current = undefined;
      setSaved(false);
      setError('');
      return true;
    } catch {
      setError('Your project saved, but this recovery draft could not be removed. It remains available in Draft recovery.');
      return false;
    }
  }
  return {
    value,
    update,
    clear,
    error,
    saved,
    dirty: !equal(value, initialRef.current),
    raw: () => JSON.stringify({ ...scopeRef.current, id: id.current, updatedAt: now(), data: current.current }, null, 2),
  };
}
