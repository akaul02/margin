// Restore points and pre-upgrade archives, shared by browser storage and the local data file.
// `check` validates a stored project and returns it, or throws. Archives only need validateProject;
// restore points also pass the export size check.

const MAX_POINTS = 20;
const MAX_BYTES = 20_000_000;
const byteLength = text => new TextEncoder().encode(text).length;

/** The readable restore points in a stored list. */
export function validPoints(raw, check) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(point => {
    try {
      if (
        typeof point.id !== 'string' ||
        typeof point.label !== 'string' ||
        typeof point.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(point.createdAt))
      )
        return [];
      const project = check(point.project);
      return [{ id: point.id, label: point.label.slice(0, 300), createdAt: point.createdAt, project }];
    } catch {
      return [];
    }
  });
}

/** A project's restore points after adding one: the latest 20, at most 20 MB. `corrupt` means part of the stored list could not be read. */
export function addRestorePoint(raw, point, check) {
  const points = validPoints(raw, check).filter(x => x.project.id === point.project.id);
  const corrupt = raw !== undefined && (!Array.isArray(raw) || points.length !== raw.length);
  points.push(point);
  const sizes = points.map(p => byteLength(JSON.stringify(p)) + 1);
  let total = sizes.reduce((sum, size) => sum + size, 1);
  while (points.length > MAX_POINTS || (points.length > 1 && total > MAX_BYTES)) {
    points.shift();
    total -= sizes.shift();
  }
  return { points, corrupt };
}

/** Readable version 1 and 2 projects in a stored workspace, keyed for the archive kept before their first upgrade. */
export function legacyArchives(storedProjects, check) {
  const out = new Map();
  for (const raw of Array.isArray(storedProjects) ? storedProjects : []) {
    if (![1, 2].includes(raw?.version) || typeof raw.id !== 'string' || out.has(raw.id)) continue;
    try {
      check(raw);
    } catch {
      continue;
    }
    out.set(raw.id, [`v${raw.version}:${raw.id}`, raw]);
  }
  return [...out.values()];
}
