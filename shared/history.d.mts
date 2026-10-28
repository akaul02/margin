type Point<P> = { id: string; label: string; createdAt: string; project: P };
export function validPoints<P>(raw: unknown, check: (project: unknown) => P): Point<P>[];
export function addRestorePoint<P extends { id: string }>(
  raw: unknown,
  point: Point<P>,
  check: (project: unknown) => P,
): { points: Point<P>[]; corrupt: boolean };
export function legacyArchives(storedProjects: unknown, check: (project: unknown) => unknown): [string, unknown][];
