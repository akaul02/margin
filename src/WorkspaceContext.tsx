import { createContext, useContext } from 'react';
import { createWorkspaceStorage } from './storage';
import { createCollaboration } from './collaboration';
export const localWorkspace = { namespace: '', hosted: false, userId: '', storage: createWorkspaceStorage(), collaboration: createCollaboration() };
export type WorkspaceServices = typeof localWorkspace;
export const WorkspaceContext = createContext<WorkspaceServices>(localWorkspace);
export const useWorkspaceServices = () => useContext(WorkspaceContext);
