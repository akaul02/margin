import type { Server } from 'node:http';
export function startRoomServer(options: {
  port?: number;
  dataDir: string;
  allowedOrigins: string[] | Set<string>;
  validateProject: (value: unknown) => unknown;
  exportProject: (project: any) => string;
  store?: ReturnType<typeof import('./store.mjs').openStore>;
  storeKey?: string;
}): Promise<{ server: Server; close: () => Promise<void> }>;
