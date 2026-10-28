export function defaultDataDir(): string;
export function dataKey(dir: string): string;
export function sameKey(a: string, b: string): boolean;
export function openStore(
  dir: string,
  model: { validateProject: (project: unknown) => unknown; exportProject: (project: any) => string },
): {
  file: string;
  workspace(): unknown;
  save(input: {
    next: unknown;
    expectedRevision: string;
    point?: { id: string; label: string; createdAt: string; project: { id: string } };
  }): boolean;
  deleteProject(input: { next: unknown; expectedRevision: string; projectId: string }): boolean;
  history(projectId: string): { history: unknown; v1: unknown; v2: unknown; corrupt: Record<string, unknown> };
  importBrowser(input: { workspace: unknown; entries: Record<string, unknown> }): number;
  close(): void;
};
