import type { Server } from 'node:http';
export function startRoomServer(options: {
  port?: number;
  dataDir: string;
  allowedOrigins: string[] | Set<string>;
  validateProject: (value: unknown) => unknown;
  exportProject: (project: any) => string;
}): Promise<{ server: Server; close: () => Promise<void> }>;
