// Conditional, atomic edits to complete records. No source text interpretation.
export const collections = ['transcripts', 'codes', 'quotes', 'memos', 'themes', 'boardGroups', 'comments', 'boardNotes'];
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const equal = (a, b) => canonical(a) === canonical(b);
const sameMembers = (a, b) => {
  if (a.length !== b.length) return false;
  const ids = new Set(a);
  return ids.size === a.length && new Set(b).size === b.length && b.every(id => ids.has(id));
};
export function diffProject(before, after) {
  if (before.id !== after.id) throw new Error('A change cannot replace the project identity.');
  const changes = [];
  for (const collection of collections) {
    // A collection added in a later version (boardNotes) is simply empty in older saved projects.
    const old = new Map((before[collection] ?? []).map(x => [x.id, x]));
    const next = new Map((after[collection] ?? []).map(x => [x.id, x]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id) ?? null,
        b = next.get(id) ?? null;
      if (!equal(a, b)) changes.push({ collection, id, before: structuredClone(a), after: structuredClone(b) });
    }
  }
  for (const field of ['name', 'synthetic'])
    if (!equal(before[field], after[field])) changes.push({ collection: 'project', id: field, before: before[field], after: after[field] });
  // A permutation is its own conditional edit, independent of group contents.
  // Creation/deletion keeps the usual collection operation semantics.
  const previousOrder = (before.boardGroups ?? []).map(group => group.id);
  const nextOrder = (after.boardGroups ?? []).map(group => group.id);
  if (!equal(previousOrder, nextOrder) && sameMembers(previousOrder, nextOrder))
    changes.push({ collection: 'order', id: 'boardGroups', before: previousOrder, after: nextOrder });
  return changes;
}
export function validateOperation(op) {
  const bad = () => {
    throw new Error('Invalid saved operation.');
  };
  if (
    !op ||
    typeof op !== 'object' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(op.id) ||
    typeof op.projectId !== 'string' ||
    !op.projectId ||
    typeof op.at !== 'string' ||
    !Number.isFinite(Date.parse(op.at)) ||
    typeof op.label !== 'string' ||
    op.label.length > 300 ||
    !Array.isArray(op.changes) ||
    !op.changes.length ||
    op.changes.length > 100_000
  )
    bad();
  const seen = new Set();
  for (const c of op.changes) {
    if (
      !c ||
      typeof c !== 'object' ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 100 ||
      !('before' in c) ||
      !('after' in c) ||
      equal(c.before, c.after)
    )
      bad();
    const key = `${c.collection}:${c.id}`;
    if (seen.has(key)) bad();
    seen.add(key);
    if (c.collection === 'project') {
      if (!['name', 'synthetic'].includes(c.id)) bad();
      const type = c.id === 'name' ? 'string' : 'boolean';
      if (typeof c.before !== type || typeof c.after !== type) bad();
    } else if (c.collection === 'order') {
      const validOrder = value =>
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 20_000 &&
        value.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id));
      if (c.id !== 'boardGroups' || !validOrder(c.before) || !validOrder(c.after) || !sameMembers(c.before, c.after)) bad();
    } else {
      if (!collections.includes(c.collection)) bad();
      for (const v of [c.before, c.after]) if (v !== null && (!v || typeof v !== 'object' || Array.isArray(v) || v.id !== c.id)) bad();
    }
  }
  // A reorder must not add/remove records as a side effect, regardless of the
  // order of changes supplied by a client. Ordinary content edits may coexist.
  if (seen.has('order:boardGroups') && op.changes.some(c => c.collection === 'boardGroups' && (c.before === null || c.after === null)))
    bad();
  return op;
}
export function recordAt(project, change) {
  if (change.collection === 'order') return (project.boardGroups ?? []).map(group => group.id);
  return change.collection === 'project' ? project[change.id] : ((project[change.collection] ?? []).find(x => x.id === change.id) ?? null);
}
export function applyOperation(project, operation) {
  validateOperation(operation);
  if (project.id !== operation.projectId) throw new Error('The operation belongs to a different project.');
  const conflicts = operation.changes.filter(c => !equal(recordAt(project, c), c.before));
  if (conflicts.length) return { conflicts, project: null };
  const next = structuredClone(project);
  for (const c of operation.changes) {
    if (c.collection === 'order') continue;
    if (c.collection === 'project') {
      next[c.id] = c.after;
      continue;
    }
    next[c.collection] ??= [];
    const index = next[c.collection].findIndex(x => x.id === c.id);
    if (c.after === null) next[c.collection].splice(index, 1);
    else if (index < 0) next[c.collection].push(structuredClone(c.after));
    else next[c.collection][index] = structuredClone(c.after);
  }
  for (const c of operation.changes.filter(c => c.collection === 'order')) {
    const groups = new Map(next.boardGroups.map(group => [group.id, group]));
    if (!sameMembers([...groups.keys()], c.after)) return { conflicts: [c], project: null };
    next.boardGroups = c.after.map(id => groups.get(id));
  }
  next.updatedAt = operation.at;
  return { conflicts: [], project: next };
}
export function inverseOperation(operation, id, at) {
  return {
    ...operation,
    id,
    at,
    label: 'Undo my last change.',
    changes: operation.changes.map(c => ({ ...c, before: structuredClone(c.after), after: structuredClone(c.before) })),
  };
}
export function assertImmutableSources(before, after) {
  for (const t of before.transcripts) {
    const next = after.transcripts.find(x => x.id === t.id);
    if (
      next &&
      (next.text !== t.text ||
        !equal(
          next.turns.map(({ id, start, end }) => ({ id, start, end })),
          t.turns.map(({ id, start, end }) => ({ id, start, end })),
        ))
    )
      throw new Error('Original source text and turn references cannot change.');
  }
  for (const q of before.quotes) {
    const next = after.quotes.find(x => x.id === q.id);
    if (next && ['transcriptId', 'turnId', 'start', 'end', 'text', 'createdAt'].some(k => !equal(next[k], q[k])))
      throw new Error('An exact quote and its stable source reference cannot change.');
  }
}
