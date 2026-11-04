import type { Project } from '../src/model';
export type Collection =
  'transcripts' | 'codes' | 'quotes' | 'memos' | 'themes' | 'boardGroups' | 'comments' | 'boardNotes' | 'project' | 'order';
export type RecordChange = { collection: Collection; id: string; before: any; after: any };
export type Operation = { id: string; projectId: string; at: string; label: string; changes: RecordChange[] };
export const collections: Exclude<Collection, 'project' | 'order'>[];
export function canonical(value: unknown): string;
export function equal(a: unknown, b: unknown): boolean;
export function diffProject(before: Project, after: Project): RecordChange[];
export function validateOperation(value: unknown): Operation;
export function recordAt(project: Project, change: RecordChange): any;
export function applyOperation(project: Project, operation: Operation): { conflicts: RecordChange[]; project: Project | null };
export function inverseOperation(operation: Operation, id: string, at: string): Operation;
export function assertImmutableSources(before: Project, after: Project): void;
