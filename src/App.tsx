import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import cealLogo from './assets/ceal-logo.png';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Columns3,
  FileText,
  FolderOpen,
  Highlighter,
  History,
  House,
  Keyboard,
  List,
  LockKeyhole,
  Merge,
  MoreHorizontal,
  GitBranch,
  MessageSquare,
  Pencil,
  Plus,
  Quote as QuoteIcon,
  Search,
  Settings2,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  renameProject,
  renameTranscript,
  removeTranscript,
  removeMemo,
  removeCode,
  addCode,
  assignQuote,
  guessRoles,
  turnRoleLabel,
  moveCard,
  codeCSV,
  copy,
  download,
  exportProject,
  importProject,
  makeTranscript,
  mergeCodes,
  newProject,
  now,
  quoteCSV,
  themeCSV,
  removeQuote,
  saveQuoteCard,
  readTextFile,
  renameCode,
  required,
  setRole,
  sourceOffsetFromTextarea,
  uid,
  validateProject,
  type Code,
  type Memo,
  type Project,
  type Quote,
  type Role,
  type Transcript,
  type Turn,
  type Workspace,
} from './model';
import { ErrorBox, Empty, Dialog, Field, CodeDot } from './ui';
import { Workbench, Evidence, HistoryPanel, useDraftGuard } from './Workbench';
import { useTutorial } from './tutorial';
import { markGreeted, SealHello } from './SealHello';
import { DisplayMenu, useDisplay } from './Display';
import { SharedError, type SharedRoom } from './collaboration';
import { applyOperation, assertImmutableSources, diffProject, inverseOperation, equal, type Operation } from '../shared/operations.mjs';
import { ConflictDialog } from './Conflicts';
import { DraftRecovery, DraftStatus } from './DraftRecovery';
import { removeProjectDrafts, useDurableDraft } from './drafts';
import { QuoteBoard, JoinRoomDialog, GroupDialog, groupPapers, splitTitle } from './Board';
import { Tip, useTips, groupKeys, saveCustomKeys, forgetProjectPrefs, Kbd, UNGROUPED_KEY } from './guidance';
import { demoProject } from './demo';
import { useWorkspaceServices } from './WorkspaceContext';

type Selection = { transcriptId: string; turnId: string; start: number; end: number; text: string };
type Modal = 'new' | 'import' | 'restore' | 'export' | 'help' | 'projects' | 'roles' | 'source' | 'join' | 'history' | null;
type View = 'board' | 'read' | 'quotes' | 'memos' | 'workbench';
const roles: Role[] = ['unassigned', 'participant', 'interviewer'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const roleLabel = (r: Role) => (r === 'unassigned' ? 'Not assigned' : r === 'participant' ? 'Participant' : 'Interviewer · context only');
export default function App() {
  const services = useWorkspaceServices(),
    { hosted } = services;
  const { loadWorkspace, rawWorkspace, saveWorkspace, deleteProjectStorage } = services.storage;
  const { createRoom, readRoom, writeRoom, watchRoom, sendOperation, assertShareableProject, assertShareableEdit } = services.collaboration;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  workspaceRef.current = workspace;
  const [syncProblem, setSyncProblem] = useState('');
  const [reviewConflict, setReviewConflict] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [view, setView] = useState<View>(() => {
    try {
      const value = localStorage.getItem('margin-view');
      return ['board', 'read', 'quotes', 'memos', 'workbench'].includes(value ?? '') ? (value as View) : 'board';
    } catch {
      return 'board';
    }
  });
  const [transcriptId, setTranscriptId] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [codeDialog, setCodeDialog] = useState<Code | 'new' | null>(null);
  const [memoDialog, setMemoDialog] = useState<Memo | 'new' | null>(null);
  const [selectTurn, setSelectTurn] = useState<Turn | null>(null);
  const [context, setContext] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<Operation[]>([]);
  const [groupDialog, setGroupDialog] = useState(false);
  const [keysDialog, setKeysDialog] = useState(false);
  const [, setKeyVersion] = useState(0);
  const [filed, setFiled] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [tutorial, setTutorial] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: 'project' | 'transcript'; id: string; name: string } | null>(null);
  const [deletingTranscript, setDeletingTranscript] = useState<Transcript | null>(null);
  const display = useDisplay();
  const project = workspace?.projects.find(p => p.id === workspace.activeId) ?? null;
  const transcript = project?.transcripts.find(t => t.id === transcriptId) ?? project?.transcripts[0];
  const tips = useTips(project, view);
  useTutorial(
    tutorial && !!project?.synthetic,
    {
      view,
      selection: !!selection,
      quotes: project?.quotes.length ?? 0,
      groups: project?.boardGroups.length ?? 0,
      grouped: project?.boardGroups.filter(g => g.quoteIds.length).length ?? 0,
      notes: project?.boardNotes.length ?? 0,
    },
    () => setTutorial(false),
  );
  async function startDemo() {
    setModal(null);
    markGreeted();
    if (await openProject(demoProject(), true)) setTutorial(true);
  }
  const keys = project ? groupKeys(project.id, project.boardGroups) : {};
  const papers = project ? groupPapers(project.boardGroups) : {};
  useEffect(() => {
    if (view !== 'read' || !selection || !project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || document.querySelector('dialog[open]')) return;
      if (
        (e.target as HTMLElement | null)?.closest(
          'textarea, select, [contenteditable="true"], input:not([type=checkbox]):not([type=radio])',
        )
      )
        return;
      const key = e.key.toLowerCase();
      const groupId = key === UNGROUPED_KEY ? null : Object.entries(keys).find(([, k]) => k === key)?.[0];
      if (groupId === undefined) return;
      e.preventDefault();
      void fileSelection(groupId);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    try {
      localStorage.setItem('margin-view', view);
    } catch {}
  }, [view]);
  useEffect(() => {
    loadWorkspace()
      .then(setWorkspace)
      .catch(e => setLoadError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saving) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [saving]);
  function adoptWorkspace(next: Workspace) {
    workspaceRef.current = next;
    setWorkspace(next);
  }
  // Read storage again after every network response. Another tab may have
  // queued new work while this tab was waiting; only acknowledge this exact ID.
  async function acknowledge(
    projectId: string,
    room: SharedRoom,
    operationId?: string,
    created = false,
    expectedWorkspaceRevision?: string,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await loadWorkspace(),
        c = latest.connections?.[projectId];
      if (expectedWorkspaceRevision !== undefined && latest.revision !== expectedWorkspaceRevision)
        throw new Error('Another tab changed this workspace. Its work is kept. Reload to reconcile the earlier save.');
      if (!c || c.roomId !== room.id) {
        adoptWorkspace(latest);
        return;
      }
      if (created && !c.creating) {
        adoptWorkspace(latest);
        return;
      }
      if (operationId && !c.pending?.some(op => op.id === operationId)) {
        adoptWorkspace(latest);
        return;
      }
      const pending = (c.pending ?? []).filter(op => op.id !== operationId);
      const next: Workspace = {
        ...latest,
        revision: uid(),
        projects: pending.length ? latest.projects : latest.projects.map(p => (p.id === projectId ? room.project : p)),
        connections: {
          ...latest.connections,
          [projectId]: {
            ...c,
            revision: room.revision,
            pending,
            dirty: pending.length > 0,
            creating: created ? undefined : c.creating,
            conflict: undefined,
          },
        },
      };
      try {
        await saveWorkspace(next, latest.revision);
        adoptWorkspace(next);
        setSyncProblem('');
        return;
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
  }
  async function publishShared(base: Workspace, projectId: string) {
    let current = base;
    try {
      let c = current.connections?.[projectId];
      if (!c) return;
      if (c.creating) {
        const room = await createRoom(c.creating, c.roomId);
        await acknowledge(projectId, room, undefined, true);
        current = workspaceRef.current!;
        c = current.connections?.[projectId];
      }
      if (!c || c.conflict) return;
      // Existing pre-upgrade pending snapshots have no record baseline. Keep
      // their original revision check; never guess a merge for old work.
      if (c.dirty && c.pending === undefined) {
        const room = await writeRoom(
          c.roomId,
          c.revision,
          current.projects.find(p => p.id === projectId)!,
        );
        await acknowledge(projectId, room, undefined, false, current.revision);
        return;
      }
      while (c?.pending?.length) {
        const operation = c.pending[0];
        try {
          const room = await sendOperation(c.roomId, operation);
          await acknowledge(projectId, room, operation.id);
        } catch (e) {
          if (e instanceof SharedError && e.data?.error === 'operation_conflict') {
            const remote = e.data.room as SharedRoom;
            validateProject(remote.project);
            const latest = await loadWorkspace(),
              live = latest.connections?.[projectId];
            if (live?.roomId === c.roomId && live.pending?.some(op => op.id === operation.id)) {
              const next = {
                ...latest,
                revision: uid(),
                connections: {
                  ...latest.connections,
                  [projectId]: {
                    ...live,
                    conflict: { operationId: operation.id, reason: e.data.reason, remote: remote.project, revision: remote.revision },
                  },
                },
              };
              await saveWorkspace(next, latest.revision);
              adoptWorkspace(next);
            }
          }
          throw e;
        }
        current = workspaceRef.current!;
        c = current.connections?.[projectId];
        if (c?.conflict) return;
      }
    } catch (e) {
      setSyncProblem((e as Error).message);
    }
  }
  async function save(next: Workspace, message: string, checkpoint?: Project, publish = true): Promise<boolean> {
    const current = workspaceRef.current;
    if (!current || lock.current) return false;
    if (next.revision !== current.revision) {
      setError('This workspace changed while you were editing. Your draft is still here; retry after reviewing the latest version.');
      return false;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const shared = checkpoint && publish && next.connections?.[checkpoint.id];
      if (shared && checkpoint) {
        const value = next.projects.find(p => p.id === checkpoint.id)!;
        const operation: Operation = {
          id: uid(),
          projectId: checkpoint.id,
          at: now(),
          label: message.slice(0, 300),
          changes: diffProject(checkpoint, value),
        };
        assertShareableEdit(value, operation);
        const pending =
          shared.dirty && shared.pending === undefined && !shared.creating
            ? undefined
            : [...(shared.pending ?? []), ...(operation.changes.length ? [operation] : [])];
        next = { ...next, connections: { ...next.connections, [checkpoint.id]: { ...shared, dirty: true, pending } } };
      }
      next.revision = uid();
      await saveWorkspace(next, current.revision, checkpoint ? { project: checkpoint, label: message } : undefined);
      adoptWorkspace(next);
      setNotice(message);
      if (shared && checkpoint) await publishShared(next, checkpoint.id);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function checkShared(projectId: string) {
    if (lock.current || document.querySelector('dialog[open]')) return;
    const current = workspaceRef.current,
      connection = current?.connections?.[projectId];
    if (!current || !connection || current.activeId !== projectId) return;
    try {
      if (connection.creating) {
        lock.current = true;
        setSaving(true);
        try {
          await publishShared(current, projectId);
        } finally {
          lock.current = false;
          setSaving(false);
        }
        return;
      }
      const remote = await readRoom(connection.roomId);
      if (lock.current || document.querySelector('dialog[open]') || workspaceRef.current !== current) return;
      const local = current.projects.find(p => p.id === projectId)!;
      if (remote.project.id !== projectId) throw new Error('The room project identity does not match. Your local work is unchanged.');
      if (connection.dirty) {
        if (connection.conflict) return;
        if (connection.pending !== undefined || connection.creating) {
          lock.current = true;
          setSaving(true);
          try {
            await publishShared(current, projectId);
          } finally {
            lock.current = false;
            setSaving(false);
          }
          return;
        }
        if (equal(local, remote.project)) {
          lock.current = true;
          try {
            await acknowledge(projectId, remote, undefined, false, current.revision);
          } finally {
            lock.current = false;
          }
        } else setSyncProblem('Pre-upgrade local edits need a retry or a separate copy before loading shared work.');
        return;
      }
      if (connection.revision === remote.revision) {
        setSyncProblem('');
        return;
      }
      const next = {
        ...current,
        projects: current.projects.map(p => (p.id === projectId ? remote.project : p)),
        connections: { ...current.connections, [projectId]: { roomId: remote.id, revision: remote.revision, dirty: false, pending: [] } },
      };
      if (await save(next, 'Shared board updated from another browser.', local, false)) {
        setSelection(null);
        setSelectedCodes([]);
        setSyncProblem('');
      }
    } catch (e) {
      setSyncProblem((e as Error).message);
    }
  }
  const connection = project ? workspace?.connections?.[project.id] : undefined;
  useEffect(() => {
    if (!project || !connection) return;
    const id = project.id;
    const refresh = () => {
      void checkShared(id);
    };
    const stop = watchRoom(connection.roomId, refresh, () =>
      setSyncProblem('Connection interrupted. Any edits you make are kept in this browser until sharing resumes.'),
    );
    const timer = setInterval(refresh, hosted ? 10000 : 5000);
    refresh();
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [project?.id, connection?.roomId]);
  async function beginSharing() {
    const current = workspaceRef.current,
      p = current?.projects.find(p => p.id === current.activeId);
    if (!current || !p || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      assertShareableProject(p);
      const next = {
        ...current,
        revision: uid(),
        connections: { ...current.connections, [p.id]: { roomId: uid(), revision: '', dirty: true, creating: copy(p), pending: [] } },
      };
      await saveWorkspace(next, current.revision);
      adoptWorkspace(next);
      await publishShared(next, p.id);
      setNotice(
        hosted
          ? 'The shared project request and any retries are saved in this account’s browser workspace.'
          : 'The local session request and any retries are saved on this device.',
      );
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function joinSharing(id: string) {
    if (lock.current) return;
    setError('');
    const room = await readRoom(id.trim());
    const current = workspaceRef.current;
    if (!current) return;
    const existing = current.projects.find(p => p.id === room.project.id),
      projects = current.projects.filter(p => p.id !== room.project.id);
    if (existing && exportProject(existing) !== exportProject(room.project)) {
      const preserved = copy(existing);
      preserved.id = uid();
      preserved.name = preserved.name.slice(0, 106) + ' (local copy)';
      exportProject(preserved);
      projects.push(preserved);
    }
    projects.push(room.project);
    if (
      await save(
        {
          ...current,
          projects,
          activeId: room.project.id,
          connections: {
            ...current.connections,
            [room.project.id]: { roomId: room.id, revision: room.revision, dirty: false, pending: [] },
          },
        },
        hosted
          ? 'Opened the shared board. Existing differing work was kept as a separate copy.'
          : 'Joined the local shared board. Existing differing work was kept as a separate copy.',
      )
    ) {
      setHistory([]);
      setSelection(null);
      setView('board');
      setSyncProblem('');
    } else throw new Error('The shared board could not be saved locally. Your existing work is unchanged.');
  }
  async function retrySharing() {
    const current = workspaceRef.current;
    if (!current || !project || lock.current) return;
    lock.current = true;
    setSaving(true);
    try {
      await publishShared(current, project.id);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function keepCopyAndLoadShared() {
    const current = workspaceRef.current;
    if (!current || !project || !connection || lock.current) return;
    try {
      const remote = await readRoom(connection.roomId);
      if (workspaceRef.current !== current) return;
      const preserved = copy(project);
      preserved.id = uid();
      preserved.name = preserved.name.slice(0, 106) + ' (local copy)';
      exportProject(preserved);
      if (
        await save(
          {
            ...current,
            projects: [...current.projects.map(p => (p.id === project.id ? remote.project : p)), preserved],
            connections: {
              ...current.connections,
              [project.id]: { roomId: remote.id, revision: remote.revision, dirty: false, pending: [] },
            },
          },
          'Your local edits were kept in a separate project. The shared version is now open.',
          project,
          false,
        )
      ) {
        setHistory([]);
        setSelection(null);
        setSyncProblem('');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function change(mutator: (p: Project) => void, message: string): Promise<boolean> {
    if (!project || !workspace || lock.current) return false;
    try {
      const next = copy(project);
      mutator(next);
      next.updatedAt = now();
      assertImmutableSources(project, next);
      validateProject(next);
      if (!diffProject(project, next).length) return true;
      exportProject(next); // Preflight the canonical UTF-8 backup size before committing.
      const ok = await save({ ...workspace, projects: workspace.projects.map(p => (p.id === next.id ? next : p)) }, message, project);
      if (ok)
        setHistory(h => [
          ...h.slice(-29),
          { id: uid(), projectId: project.id, at: now(), label: message, changes: diffProject(project, next) },
        ]);
      return ok;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function openProject(p: Project, isNew = false) {
    if (!workspace) return false;
    try {
      exportProject(p);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
    if (isNew && workspace.projects.some(x => x.id === p.id)) {
      setError('This project is already in your workspace. Import a backup as a separate copy from the import dialog.');
      return false;
    }
    const ok = await save(
      { ...workspace, projects: isNew ? [...workspace.projects, p] : workspace.projects, activeId: p.id },
      isNew ? 'Project saved on this device.' : 'Project opened.',
    );
    if (ok) {
      setHistory([]);
      setSelection(null);
      setSelectedCodes([]);
      setTranscriptId(p.transcripts[0]?.id ?? '');
      setView('board');
      setFilter('all');
      setSearch('');
      setModal(null);
      setFiled('');
    }
    return ok;
  }
  async function undo() {
    if (!history.length || !workspace || !project || connection?.dirty) return;
    try {
      const op = inverseOperation(history[history.length - 1], uid(), now()),
        applied = applyOperation(project, op);
      if (!applied.project)
        throw new Error(
          'Someone changed an item from your last edit. Undo stopped so their work stays intact. Review a restore point or edit the item explicitly.',
        );
      validateProject(applied.project);
      exportProject(applied.project);
      if (
        await save(
          { ...workspace, projects: workspace.projects.map(p => (p.id === project.id ? applied.project! : p)) },
          'Undid only your last change.',
          project,
        )
      ) {
        setHistory(h => h.slice(0, -1));
        setSelection(null);
        setSelectedCodes([]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function resolveSharedConflict(asSeparateNote: boolean) {
    const current = workspaceRef.current,
      local = current?.projects.find(p => p.id === current.activeId),
      c = local && current?.connections?.[local.id];
    if (!current || !local || !c || lock.current) return;
    const remote = await readRoom(c.roomId);
    if (workspaceRef.current !== current) throw new Error('The workspace changed. Review the versions again.');
    const preserved = copy(local);
    preserved.id = uid();
    preserved.name = preserved.name.slice(0, 106) + ' (local copy)';
    exportProject(preserved);
    const nextProject = copy(remote.project),
      op = c.pending?.find(x => x.id === c.conflict?.operationId);
    if (asSeparateNote) {
      const change = op?.changes.find(x => x.collection === 'comments' && x.after);
      const note = local.comments.find(x => x.id === change?.id);
      if (!note) throw new Error('This local note is no longer present. Keep the local copy to review all your changes.');
      if (!nextProject.quotes.some(q => q.id === note.quoteId))
        throw new Error('The quote was removed. Keep your local copy; it retains the exact quote and your note together.');
      const date = now();
      nextProject.comments.push({ ...note, id: uid(), createdAt: date, updatedAt: date });
      nextProject.updatedAt = date;
    }
    const changes = diffProject(remote.project, nextProject),
      pending: Operation[] = changes.length
        ? [{ id: uid(), projectId: local.id, at: now(), label: 'Kept the conflicting note as a separate note.', changes }]
        : [];
    const next = {
      ...current,
      projects: [...current.projects.map(p => (p.id === local.id ? nextProject : p)), preserved],
      connections: {
        ...current.connections,
        [local.id]: { roomId: remote.id, revision: remote.revision, dirty: pending.length > 0, pending },
      },
    };
    if (await save(next, 'All local work was kept in a separate project. The shared board is now open.', local, false)) {
      setReviewConflict(false);
      setHistory([]);
      setSyncProblem('');
      if (pending.length) await retrySharing();
    } else throw new Error('The versions could not be saved locally. Your pending work is unchanged.');
  }
  function navigate(v: View) {
    setView(v);
    setSelection(null);
    setError('');
    setFiled('');
  }
  async function deleteProject(p: Project) {
    const current = workspaceRef.current;
    if (!current || lock.current) return false;
    const connections = { ...current.connections };
    delete connections[p.id];
    const next: Workspace = {
      ...current,
      projects: current.projects.filter(x => x.id !== p.id),
      activeId: current.activeId === p.id ? null : current.activeId,
      connections,
      revision: uid(),
    };
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await deleteProjectStorage(next, current.revision, p.id);
      adoptWorkspace(next);
      removeProjectDrafts(p.id, services.namespace);
      forgetProjectPrefs(p.id);
      if (current.activeId === p.id) {
        setHistory([]);
        setSelection(null);
        setFiled('');
        setModal(null);
      }
      setNotice(`Deleted ${p.name}.`);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function rename(kind: 'project' | 'transcript', id: string, name: string) {
    if (kind === 'transcript') return change(p => renameTranscript(p, id, name), 'Transcript renamed.');
    if (id === project?.id) return change(p => renameProject(p, name), 'Project renamed.');
    const current = workspaceRef.current;
    if (!current) return false;
    try {
      const target = copy(current.projects.find(x => x.id === id)!);
      renameProject(target, name);
      target.updatedAt = now();
      return save({ ...current, projects: current.projects.map(x => (x.id === id ? target : x)) }, 'Project renamed.');
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function goHome() {
    const current = workspaceRef.current;
    if (!current?.activeId) return;
    setModal(null);
    setSelection(null);
    setFiled('');
    await save({ ...current, activeId: null }, 'Back to your projects.');
  }
  function chooseTranscript(id: string) {
    setTranscriptId(id);
    navigate('read');
  }
  function pick(pick: Selection) {
    setSelection(pick);
    setSelectedCodes([]);
    setError('');
    setFiled('');
  }
  async function fileSelection(groupId: string | null) {
    if (!selection || !project || saving) return;
    const s = selection;
    const title = groupId ? (project.boardGroups.find(g => g.id === groupId)?.title ?? 'its group') : 'Ungrouped';
    if (
      await change(p => {
        const q = saveQuoteCard(p, s.transcriptId, s.turnId, s.start, s.end, s.text);
        if (groupId) moveCard(p, q.id, groupId);
      }, `Quote card added to ${title}.`)
    ) {
      setSelection(null);
      setSelectedCodes([]);
      setFiled(title);
      window.getSelection()?.removeAllRanges();
    }
  }
  function captureSelection() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !transcript) return;
    const range = s.getRangeAt(0);
    const parent = (n: Node) =>
      (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement)?.closest<HTMLElement>('[data-turn-text]');
    const startEl = parent(range.startContainer);
    const endEl = parent(range.endContainer);
    if (!startEl && !endEl) return;
    if (!startEl || startEl !== endEl) {
      setSelection(null);
      setError('Select a passage within one participant turn. Interviewer text stays as context.');
      return;
    }
    const turn = transcript.turns.find(t => t.id === startEl.dataset.turnText);
    if (!turn || turn.role !== 'participant') {
      setSelection(null);
      setError('Only participant turns can be coded. Review speaker roles if this turn is mislabeled.');
      return;
    }
    const before = document.createRange();
    before.selectNodeContents(startEl);
    before.setEnd(range.startContainer, range.startOffset);
    const start = turn.start + before.toString().length;
    const end = start + range.toString().length;
    if (end > turn.end || !transcript.text.slice(start, end).trim() || transcript.text.slice(start, end) !== range.toString()) {
      setSelection(null);
      setError('This selection could not be matched to the original words. Select a non-empty passage again, or use Select passage.');
      return;
    }
    pick({ transcriptId: transcript.id, turnId: turn.id, start, end, text: range.toString() });
  }
  async function applyCodes() {
    if (!selection || !project) return;
    if (
      await change(p => {
        assignQuote(p, selection.transcriptId, selection.turnId, selection.start, selection.end, selectedCodes, selection.text);
      }, 'Exact quote saved with your codes.')
    ) {
      setSelection(null);
      setSelectedCodes([]);
      window.getSelection()?.removeAllRanges();
    }
  }
  const exportName = project?.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'project';
  function jump(q: Quote) {
    chooseTranscript(q.transcriptId);
    setContext(true);
    setTimeout(() => {
      const el = document.getElementById(`turn-${q.turnId}`);
      el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      el?.focus({ preventScroll: true });
    }, 50);
  }
  if (loadError)
    return (
      <main className="loading">
        <LockKeyhole size={36} />
        <h1>Your saved work is protected.</h1>
        <p>Margin could not open local storage. Nothing has been overwritten.</p>
        <ErrorBox error={loadError} />
        <div className="button-row">
          <button className="primary" onClick={() => location.reload()}>
            Try again
          </button>
          <button
            onClick={async () => {
              try {
                download('margin-recovery.json', await rawWorkspace());
              } catch (e) {
                setLoadError((e as Error).message);
              }
            }}
          >
            Download recovery data
          </button>
        </div>
      </main>
    );
  if (!workspace)
    return (
      <main className="loading" aria-live="polite">
        <p>Opening your local workspace…</p>
      </main>
    );
  return (
    <>
      {reviewConflict && project && connection?.conflict && (
        <ConflictDialog project={project} connection={connection} close={() => setReviewConflict(false)} resolve={resolveSharedConflict} />
      )}
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <header className="app-header" inert={saving}>
        <a
          href="#"
          className="brand"
          onClick={e => {
            e.preventDefault();
            void goHome();
          }}
          aria-label="Margin home"
          title="Home: all projects"
        >
          <img className="brand-logo" src={cealLogo} alt="" />
          <span className="brand-name">Margin</span>
        </a>
        <nav className="view-nav top-nav" aria-label="Workspace views">
          {project &&
            (
              [
                ['read', 'Transcripts'],
                ['board', 'Board'],
                ['memos', 'Memos'],
                ['workbench', 'Codes'],
              ] as const
            ).map(([v, label]) => {
              const active = view === v || (v === 'board' && view === 'quotes');
              return (
                <button key={v} data-nav={v} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => navigate(v)}>
                  {label}
                </button>
              );
            })}
        </nav>
        <div className="header-actions">
          {project && connection?.dirty && (
            <span className="save-state" title="Your latest edits are saved in this browser but not shared yet.">
              Not shared yet
            </span>
          )}
          <DisplayMenu display={display} />
          <button className="icon-button" aria-label="Help and keyboard guide" onClick={() => setModal('help')}>
            <CircleHelp size={19} />
          </button>
          {project && (
            <button className="export-button" aria-label="Export" onClick={() => setModal('export')}>
              <ArrowDownToLine size={16} />
              <span>Export</span>
            </button>
          )}
        </div>
      </header>
      {!!workspace.quarantined?.length && (
        <div className="recovery-banner" role="alert">
          <span>
            {workspace.quarantined.length} project(s) could not be opened. Their original data is kept locally; your other projects are
            available.
          </span>
          <button onClick={() => download('margin-recovery.json', JSON.stringify({ quarantined: workspace.quarantined }, null, 2))}>
            <ArrowDownToLine size={16} />
            Download recovery data
          </button>
        </div>
      )}
      {!project ? (
        <main id="main" className="welcome" tabIndex={-1}>
          <div className="welcome-copy">
            <h1>Margin</h1>
            <p>
              A quote board for qualitative analysis. Import interview transcripts, pull out participant quotes, and group them on a shared
              board.
            </p>
            {workspace.projects.length > 0 && (
              <section className="home-projects" aria-labelledby="home-projects-title">
                <h2 id="home-projects-title">Your projects</h2>
                <div className="project-list">
                  {workspace.projects.map(p => (
                    <div className="project-row" key={p.id}>
                      <button onClick={() => openProject(p)}>
                        <FolderOpen size={21} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {plural(p.transcripts.length, 'transcript')} · {plural(p.quotes.length, 'quote')}
                            {p.synthetic ? ' · Synthetic demo' : ''}
                          </small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                      <button
                        className="icon-button row-action"
                        aria-label={`Rename project ${p.name}`}
                        title="Rename project"
                        onClick={() => setRenaming({ kind: 'project', id: p.id, name: p.name })}
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="icon-button row-action delete-project"
                        aria-label={`Delete project ${p.name}`}
                        title="Delete project"
                        onClick={() => setDeleting(p)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <SealHello start={() => void startDemo()} />
            <div className="button-row">
              <button className="primary" onClick={() => setModal('new')}>
                <Plus size={18} />
                Start a project
              </button>
              <button onClick={startDemo}>
                Try the synthetic demo
                <ArrowRight size={17} />
              </button>
            </div>
            <button className="text-button" onClick={() => setModal('restore')}>
              <FolderOpen size={16} />
              Open a project backup
            </button>
            <button className="text-button" onClick={() => setModal('join')}>
              <MessageSquare size={16} />
              {hosted ? 'Open a shared board' : 'Join a local board'}
            </button>
            <div className="welcome-privacy">
              <LockKeyhole size={17} />
              <span>
                {hosted
                  ? 'Projects stay in your browser until you share them with people you invite. No AI analysis.'
                  : 'Data stays in this browser. No accounts, uploads, or AI analysis.'}
              </span>
            </div>
          </div>
        </main>
      ) : (
        <div className="app-layout" data-view={view} inert={saving}>
          <main id="main" className="workspace-main" tabIndex={-1}>
            <div className="project-bar">
              <span className="project-crumb">
                <span className="project-crumb-name">{project.name}</span>
                {project.synthetic && <span className="demo-badge">Synthetic demo</span>}
                <button className="icon-button" aria-label="Rename project" title="Rename project" onClick={() => setRenaming({ kind: 'project', id: project.id, name: project.name })}>
                  <Pencil size={15} />
                </button>
                <button className="icon-button" aria-label="Open project menu" title="Projects" onClick={() => setModal('projects')}>
                  <MoreHorizontal size={17} />
                </button>
              </span>
              <span className="top-actions">
                {project.synthetic && (
                  <button
                    className="undo-button"
                    onClick={() => {
                      navigate('board');
                      setTutorial(true);
                    }}
                  >
                    <BookOpen size={16} />
                    Tutorial
                  </button>
                )}
                <button className="undo-button" onClick={() => setModal('history')} title="Earlier saved versions of this project">
                  <History size={16} />
                  History
                </button>
                <button
                  className="undo-button"
                  disabled={!history.length || saving || !!connection?.dirty}
                  onClick={undo}
                  title="Undo only the records changed by your last edit; stop if they changed again"
                >
                  <Undo2 size={16} />
                  Undo
                </button>
              </span>
            </div>
            {error && (
              <div className="global-error">
                <ErrorBox error={error} />
                <button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}>
                  <X size={18} />
                </button>
              </div>
            )}
            {connection && (
              <section
                className={`shared-banner${connection.dirty || syncProblem ? ' needs-sync' : ''}`}
                aria-label={hosted ? 'Project sharing status' : 'Local sharing status'}
              >
                <div>
                  <strong>
                    {connection.dirty ? 'Your local edits have not been shared yet.' : hosted ? 'Shared project' : 'Local shared board'}
                  </strong>
                  <p>
                    {connection.conflict
                      ? 'Another editor changed the same item, or a linked item was removed. Both versions are kept. Review them before continuing to share.'
                      : syncProblem ||
                        (hosted
                          ? 'Connected to your lab workspace. Different notes save independently; competing edits stay available for review.'
                          : 'Connected through this computer. Different notes save independently; competing edits stay available for review.')}
                  </p>
                  <small>
                    Room ID: {connection.roomId} · {hosted ? 'signed-in project members' : 'local service, no verified accounts'}
                  </small>
                </div>
                <div className="button-row">
                  {connection.conflict && <button onClick={() => setReviewConflict(true)}>Review conflicting save</button>}
                  {connection.dirty && (
                    <>
                      <button disabled={saving} onClick={retrySharing}>
                        Retry sharing
                      </button>
                      <button disabled={saving} onClick={keepCopyAndLoadShared}>
                        Keep local copy & load shared
                      </button>
                    </>
                  )}
                  <button
                    disabled={saving}
                    onClick={async () => {
                      const current = workspaceRef.current!;
                      const connections = { ...current.connections };
                      delete connections[project!.id];
                      if (await save({ ...current, connections }, 'This browser is now working on a local copy.')) setSyncProblem('');
                    }}
                  >
                    Leave shared session
                  </button>
                </div>
              </section>
            )}
            <DraftRecovery project={project} change={change} workspaceError={error} />
            <div className="sr-only" role="status" aria-live="polite">
              {notice}
            </div>
            {project.synthetic && (
              <div className="synthetic-note">
                <span className="demo-dot" />
                Synthetic demo project. All transcripts are fictional.
              </div>
            )}
            {tips.current && !tutorial && <Tip tip={tips.current} dismiss={tips.dismiss} turnOff={tips.turnOff} />}
            {view === 'board' && (
              <QuoteBoard
                project={project}
                keys={keys}
                change={change}
                read={() => navigate('read')}
                list={() => navigate('quotes')}
                importTranscript={() => setModal('import')}
                jump={jump}
                restore={() => setModal('restore')}
                error={error || (connection?.dirty ? syncProblem : '')}
                collaboration={{ connection, create: beginSharing, join: joinSharing }}
              />
            )}
            {view === 'read' && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>Transcripts</h1>
                    <p>Read an interview and pull out quotes.</p>
                  </div>
                </div>
                <nav className="section-index" aria-label="Transcripts">
                  {project.transcripts.map(t => (
                    <button
                      key={t.id}
                      className={transcript?.id === t.id ? 'transcript-link current' : 'transcript-link'}
                      aria-current={transcript?.id === t.id ? 'true' : undefined}
                      onClick={() => chooseTranscript(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                  <button
                    className="add-transcript"
                    onClick={() => {
                      setError('');
                      setModal('import');
                    }}
                  >
                    <Plus size={16} />
                    Import transcript
                  </button>
                </nav>
                {transcript && <h2 className="reading-title">{transcript.name}</h2>}

                {transcript ? (
                  <div className="reading-layout">
                    <section className="reader" aria-label="Transcript">
                      <div className="reader-toolbar">
                        <label className="toggle-label">
                          <input type="checkbox" checked={context} onChange={e => setContext(e.target.checked)} />
                          <span>Show context turns</span>
                        </label>
                        <div>
                          <button className="text-button" onClick={() => setModal('roles')}>
                            <Settings2 size={15} />
                            Speaker roles
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setRenaming({ kind: 'transcript', id: transcript.id, name: transcript.name })}
                          >
                            <Pencil size={15} />
                            Rename
                          </button>
                          <button className="text-button" onClick={() => setDeletingTranscript(transcript)}>
                            <Trash2 size={15} />
                            Delete
                          </button>
                          <button className="icon-button" aria-label="View original transcript" onClick={() => setModal('source')}>
                            <FileText size={17} />
                          </button>
                        </div>
                      </div>
                      {transcript.turns.some(t => t.role === 'unassigned') && (
                        <div className="unassigned-note">
                          Some turns have no role yet.{' '}
                          <button className="text-button" onClick={() => setModal('roles')}>
                            Review speaker roles
                          </button>{' '}
                          before coding them.
                        </div>
                      )}
                      <div className="turn-list" onMouseUp={captureSelection} onKeyUp={captureSelection}>
                        {transcript.turns
                          .filter(t => context || t.role === 'participant')
                          .map(turn => (
                            <article id={`turn-${turn.id}`} tabIndex={-1} key={turn.id} className={`turn ${turn.role}`}>
                              <div className="turn-meta">
                                <span className="turn-number">{String(transcript.turns.indexOf(turn) + 1).padStart(2, '0')}</span>
                                <strong>{turn.label}</strong>
                                <span className="role-pill">{turn.role === 'unassigned' ? roleLabel(turn.role) : turnRoleLabel(turn)}</span>
                              </div>
                              <div className="turn-text" data-turn-text={turn.id}>
                                <HighlightedText transcript={transcript} turn={turn} quotes={project.quotes} codes={project.codes} />
                              </div>
                              {turn.role === 'participant' && (
                                <div className="turn-footer">
                                  <button className="text-button" onClick={() => setSelectTurn(turn)}>
                                    <Highlighter size={14} />
                                    Select passage
                                  </button>
                                  {project.quotes.filter(q => q.turnId === turn.id).length > 0 && (
                                    <span className="coded-note">
                                      <Check size={13} />
                                      {plural(project.quotes.filter(q => q.turnId === turn.id).length, 'quote')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </article>
                          ))}
                        {!context && !transcript.turns.some(t => t.role === 'participant') && (
                          <Empty icon={<BookOpen />} title="No participant turns yet">
                            <p>Review the speaker roles to make participant passages available.</p>
                            <button onClick={() => setModal('roles')}>Review roles</button>
                          </Empty>
                        )}
                      </div>
                      <div className="reader-end">
                        <span />
                        End of transcript
                        <span />
                      </div>
                    </section>
                    <aside className="coding-panel" aria-label="Coding panel">
                      {selection ? (
                        <section className="selection-card">
                          <div className="section-label">
                            <span>Selected passage</span>
                            <button className="icon-button" aria-label="Clear selected passage" onClick={() => setSelection(null)}>
                              <X size={16} />
                            </button>
                          </div>
                          <blockquote>{selection.text}</blockquote>
                          <h2>Add to the board</h2>
                          <p className="small muted">Click a group or press its key.</p>
                          <div className="file-list">
                            <button
                              className="file-row"
                              disabled={saving}
                              onClick={() => fileSelection(null)}
                              aria-label="Add to Ungrouped"
                            >
                              <Kbd k={UNGROUPED_KEY} />
                              <span>Ungrouped</span>
                            </button>
                            {project.boardGroups.map(g => (
                              <button
                                key={g.id}
                                className="file-row"
                                style={{ '--sticky': papers[g.id] } as CSSProperties}
                                disabled={saving}
                                onClick={() => fileSelection(g.id)}
                                aria-label={`Add to ${g.title}`}
                              >
                                <Kbd k={keys[g.id]} />
                                <span>{splitTitle(g.title).name}</span>
                                <small>{g.quoteIds.length}</small>
                              </button>
                            ))}
                          </div>
                          <div className="file-actions">
                            <button className="text-button" onClick={() => setGroupDialog(true)}>
                              <Plus size={15} />
                              New group
                            </button>
                            {project.boardGroups.length > 0 && (
                              <button className="text-button" onClick={() => setKeysDialog(true)}>
                                <Keyboard size={15} />
                                Change keys
                              </button>
                            )}
                          </div>
                          <div className="optional-code-divider">Or label it with codes</div>
                          <div className="code-choices">
                            {project.codes.map(c => (
                              <label key={c.id} className="code-check">
                                <input
                                  type="checkbox"
                                  checked={selectedCodes.includes(c.id)}
                                  onChange={e => setSelectedCodes(x => (e.target.checked ? [...x, c.id] : x.filter(id => id !== c.id)))}
                                />
                                <CodeDot color={c.color} />
                                <span>{c.name}</span>
                              </label>
                            ))}
                          </div>
                          <button className="text-button" onClick={() => setCodeDialog('new')}>
                            <Plus size={15} />
                            Create a code
                          </button>
                          {project.codes.length > 0 && (
                            <button className="primary full-width" disabled={!selectedCodes.length || saving} onClick={applyCodes}>
                              <Check size={16} />
                              Save coded quote
                            </button>
                          )}
                        </section>
                      ) : (
                        <section className="selection-placeholder">
                          {filed && (
                            <p className="filed-note">
                              <Check size={16} />
                              <span>Added to {filed}.</span>
                              <button className="text-button" onClick={() => navigate('board')}>
                                View board
                              </button>
                            </p>
                          )}
                          <h2>Select a passage</h2>
                          <p>Highlight a participant’s words, then click a group or press its key.</p>
                          {project.boardGroups.length > 0 ? (
                            <>
                              <ul className="key-legend">
                                <li>
                                  <Kbd k={UNGROUPED_KEY} />
                                  Ungrouped
                                </li>
                                {project.boardGroups
                                  .filter(g => keys[g.id])
                                  .map(g => (
                                    <li key={g.id}>
                                      <Kbd k={keys[g.id]} />
                                      {splitTitle(g.title).name}
                                    </li>
                                  ))}
                              </ul>
                              {project.boardGroups.some(g => !keys[g.id]) && (
                                <p className="small muted">
                                  {plural(project.boardGroups.filter(g => !keys[g.id]).length, 'more group')} without a key. Click one in
                                  the list after selecting, or give it a key.
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="small muted">Make board groups to file quotes with number keys.</p>
                          )}
                          <div className="file-actions">
                            <button className="text-button" onClick={() => setGroupDialog(true)}>
                              <Plus size={15} />
                              New group
                            </button>
                            {project.boardGroups.length > 0 && (
                              <button className="text-button" onClick={() => setKeysDialog(true)}>
                                <Keyboard size={15} />
                                Change keys
                              </button>
                            )}
                          </div>
                        </section>
                      )}
                      <section className="codebook">
                        <div className="codebook-header">
                          <h2>
                            Codes <span>{project.codes.length}</span>
                          </h2>
                          <button className="icon-button" aria-label="Create a code" onClick={() => setCodeDialog('new')}>
                            <Plus size={18} />
                          </button>
                        </div>
                        {project.codes.length ? (
                          <div className="code-list">
                            {project.codes.map(c => (
                              <div key={c.id} className="code-row">
                                <button
                                  className="code-browse"
                                  onClick={() => {
                                    setFilter(c.id);
                                    navigate('quotes');
                                  }}
                                >
                                  <CodeDot color={c.color} />
                                  <span>{c.name}</span>
                                  <small>{project.quotes.filter(q => q.codeIds.includes(c.id)).length}</small>
                                </button>
                                <button className="icon-button" aria-label={`Edit code ${c.name}`} onClick={() => setCodeDialog(c)}>
                                  <MoreHorizontal size={17} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="codebook-empty">
                            <p>Codes are short labels you choose for passages. They can change as your understanding grows.</p>
                            <button onClick={() => setCodeDialog('new')}>
                              <Plus size={16} />
                              Create your first code
                            </button>
                          </div>
                        )}
                      </section>
                    </aside>
                  </div>
                ) : (
                  <Empty icon={<FileText size={28} />} title="No transcripts yet">
                    <p>Import a UTF-8 text transcript. You’ll review speaker roles before you begin.</p>
                    <button className="primary" onClick={() => setModal('import')}>
                      <Plus size={17} />
                      Import your first transcript
                    </button>
                  </Empty>
                )}
              </>
            )}
            {view === 'quotes' && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>All quotes</h1>
                  </div>
                </div>
                <div className="quote-tools">
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      type="search"
                      aria-label="Search exact quotes"
                      placeholder="Search quotes"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </label>
                  <label className="filter-field">
                    <span className="sr-only">Filter by code</span>
                    <select value={filter} onChange={e => setFilter(e.target.value)}>
                      <option value="all">All codes</option>
                      {project.codes.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="quote-grid">
                  {project.quotes
                    .filter(
                      q =>
                        (filter === 'all' || q.codeIds.includes(filter)) && q.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                    )
                    .map(q => (
                      <QuoteCard
                        key={q.id}
                        quote={q}
                        project={project}
                        jump={jump}
                        remove={async () => {
                          const count = project.comments.filter(c => c.quoteId === q.id).length;
                          if (
                            count &&
                            !window.confirm(
                              `Remove this quote and its ${count} card note(s)? A restore point will keep the previous version.`,
                            )
                          )
                            return false;
                          return change(p => removeQuote(p, q.id), 'Quote removed. Use Undo to restore it.');
                        }}
                      />
                    ))}
                </div>
                {!project.quotes.length && (
                  <Empty icon={<QuoteIcon size={28} />} title="No quotes yet">
                    <p>Highlight words in a transcript to add one.</p>
                    <button onClick={() => navigate('read')}>
                      Open transcripts
                      <ArrowRight size={16} />
                    </button>
                  </Empty>
                )}
                {project.quotes.length > 0 &&
                  !project.quotes.some(
                    q =>
                      (filter === 'all' || q.codeIds.includes(filter)) && q.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                  ) && (
                    <Empty icon={<Search />} title="No matching quotes">
                      <p>Try a different phrase or choose “All codes.”</p>
                    </Empty>
                  )}
              </>
            )}
            {view === 'memos' && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>Memos</h1>
                  </div>
                  <button className="primary" onClick={() => setMemoDialog('new')}>
                    <Plus size={17} />
                    Write a memo
                  </button>
                </div>
                <div className="memo-grid">
                  {project.memos.map(m => (
                    <button key={m.id} className="memo-card" onClick={() => setMemoDialog(m)}>
                      <span className="memo-text">
                        <h2>{m.title}</h2>
                        {m.body && <p>{m.body}</p>}
                      </span>
                      <small>{new Date(m.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                    </button>
                  ))}
                </div>
                {!project.memos.length && (
                  <Empty icon={<StickyNote size={28} />} title="No memos yet">
                    <p>Write down what you notice, questions, and decisions.</p>
                  </Empty>
                )}
              </>
            )}
            {view === 'workbench' && (
              <Workbench
                key={project.id}
                project={project}
                change={change}
                editCode={setCodeDialog}
                jump={jump}
                revision={workspace.revision}
              />
            )}
          </main>
        </div>
      )}
      {renaming && (
        <RenameDialog
          kind={renaming.kind}
          name={renaming.name}
          close={() => setRenaming(null)}
          submit={async name => (await rename(renaming.kind, renaming.id, name)) && (setRenaming(null), true)}
          error={error}
        />
      )}
      {deletingTranscript && project && (
        <Dialog
          title={`Delete “${deletingTranscript.name}”?`}
          subtitle={`${plural(project.quotes.filter(q => q.transcriptId === deletingTranscript.id).length, 'quote card')} from it will go too. Undo brings it back.`}
          close={() => setDeletingTranscript(null)}
        >
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <button data-autofocus onClick={() => setDeletingTranscript(null)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={saving}
              onClick={async () => {
                const id = deletingTranscript.id;
                if (await change(p => removeTranscript(p, id), 'Transcript deleted.')) {
                  setDeletingTranscript(null);
                  setTranscriptId('');
                  setSelection(null);
                }
              }}
            >
              <Trash2 size={16} />
              Delete transcript
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'history' && project && (
        <Dialog wide title="History" subtitle="Earlier saved versions of this project." close={() => setModal(null)}>
          <HistoryPanel project={project} change={change} revision={workspace.revision} restored={() => setModal(null)} />
        </Dialog>
      )}
      {deleting && (
        <DeleteProjectDialog
          project={deleting}
          unshared={!!workspace.connections?.[deleting.id]?.dirty}
          close={() => setDeleting(null)}
          remove={() => deleteProject(deleting)}
        />
      )}
      {groupDialog && project && (
        <GroupDialog group="new" project={project} close={() => setGroupDialog(false)} change={change} error={error} />
      )}
      {keysDialog && project && <KeysDialog project={project} close={() => setKeysDialog(false)} saved={() => setKeyVersion(v => v + 1)} />}
      {modal === 'join' && <JoinRoomDialog join={joinSharing} close={() => setModal(null)} />}
      {modal === 'new' && <NewProjectDialog close={() => setModal(null)} create={p => openProject(p, true)} error={error} />}
      {modal === 'projects' && (
        <Dialog title="Your local projects" subtitle="Saved in this browser on this device." close={() => setModal(null)}>
          <div className="project-list">
            {workspace.projects.map(p => (
              <div className="project-row" key={p.id}>
                <button onClick={() => openProject(p)}>
                  <FolderOpen size={21} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {plural(p.transcripts.length, 'transcript')} · {plural(p.quotes.length, 'quote')}
                      {p.synthetic ? ' · Synthetic demo' : ''}
                    </small>
                  </span>
                  {p.id === project?.id ? <Check size={18} /> : <ArrowRight size={18} />}
                </button>
                <button
                  className="icon-button row-action"
                  aria-label={`Rename project ${p.name}`}
                  title="Rename project"
                  onClick={() => setRenaming({ kind: 'project', id: p.id, name: p.name })}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-button row-action delete-project"
                  aria-label={`Delete project ${p.name}`}
                  title="Delete project"
                  onClick={() => setDeleting(p)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {!workspace.projects.length && <p className="muted">Your first project can start here.</p>}
          </div>
          <div className="dialog-actions wrap">
            <button
              className="primary"
              onClick={() => {
                setError('');
                setModal('new');
              }}
            >
              <Plus size={16} />
              New project
            </button>
            <button onClick={() => setModal('restore')}>Import backup</button>
            <button onClick={startDemo}>Synthetic demo</button>
            <button onClick={() => setModal('join')}>{hosted ? 'Open a shared board' : 'Join a local board'}</button>
          </div>
        </Dialog>
      )}
      {modal === 'import' && project && (
        <ImportDialog
          project={project}
          close={() => setModal(null)}
          error={error}
          submit={async t => {
            if (
              await change(p => {
                if (p.transcripts.some(x => x.text === t.text)) throw new Error('This transcript is already in the project.');
                p.transcripts.push(t);
              }, 'Transcript imported. Original text preserved.')
            ) {
              chooseTranscript(t.id);
              setModal(null);
              return true;
            }
            return false;
          }}
        />
      )}
      {modal === 'restore' && (
        <RestoreDialog workspace={workspace} close={() => setModal(null)} error={error} submit={p => openProject(p, true)} />
      )}
      {modal === 'export' && project && (
        <Dialog
          title="Export"
          subtitle="Downloads stay on your device. A project backup is the way to move or restore your work."
          close={() => setModal(null)}
        >
          <div className="export-options">
            <button
              onClick={() => {
                download(`${exportName}.margin.json`, exportProject(project));
                setNotice('Project backup downloaded.');
              }}
            >
              <FolderOpen size={23} />
              <span>
                <strong>Project backup</strong>
                <small>Lossless JSON · originals, roles, quote cards, board groups, notes, code guidance & memos</small>
              </span>
              <ArrowDownToLine size={19} />
            </button>
            <button onClick={() => download(`${exportName}-quotes.csv`, quoteCSV(project), 'text/csv;charset=utf-8')}>
              <QuoteIcon size={23} />
              <span>
                <strong>Quotes & codes</strong>
                <small>CSV · one row per quote–code pair, with source context</small>
              </span>
              <ArrowDownToLine size={19} />
            </button>
            <button onClick={() => download(`${exportName}-codebook.csv`, codeCSV(project), 'text/csv;charset=utf-8')}>
              <Highlighter size={23} />
              <span>
                <strong>Codebook</strong>
                <small>CSV · definitions, inclusion / exclusion, example IDs & counts</small>
              </span>
              <ArrowDownToLine size={19} />
            </button>
            <button onClick={() => download(`${exportName}-groups.csv`, themeCSV(project), 'text/csv;charset=utf-8')}>
              <GitBranch size={23} />
              <span>
                <strong>Themes</strong>
                <small>CSV · your interpretations with code and quote reference IDs</small>
              </span>
              <ArrowDownToLine size={19} />
            </button>
          </div>
          <p className="small muted">
            Browser storage can be cleared. Keep regular project backups somewhere you trust. CSV protects spreadsheet formula cells; the
            JSON backup preserves all text exactly.
          </p>
        </Dialog>
      )}
      {modal === 'help' && (
        <Dialog title="How Margin works" close={() => setModal(null)}>
          <ol className="help-steps">
            <li>
              <strong>Import a transcript.</strong> Paste text or pick a .txt file.
            </li>
            <li>
              <strong>Pull out quotes.</strong> Highlight a participant’s words, then press a group’s number key.
            </li>
            <li>
              <strong>Sort the board.</strong> Drag cards between groups.
            </li>
            <li>
              <strong>Write memos.</strong> Your notes on what the groups add up to.
            </li>
          </ol>
          <p className="small muted">
            {hosted
              ? 'Projects save in this browser. Shared projects also save to your lab workspace, visible only to people you invite.'
              : 'Everything saves in this browser. Use Export now and then to keep a backup file.'}
          </p>
          <div className="dialog-actions">
            <button
              className="primary"
              onClick={() => {
                if (project?.synthetic) {
                  setModal(null);
                  navigate('board');
                  setTutorial(true);
                } else void startDemo();
              }}
            >
              <BookOpen size={16} />
              Take the tutorial
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'roles' && transcript && project && (
        <RolesDialog
          transcript={transcript}
          project={project}
          close={() => setModal(null)}
          error={error}
          submit={async roleMap => {
            if (
              await change(p => {
                for (const [id, role] of Object.entries(roleMap)) setRole(p, transcript.id, id, role);
              }, 'Speaker roles updated.')
            ) {
              setSelection(null);
              setModal(null);
            }
          }}
        />
      )}
      {modal === 'source' && transcript && (
        <Dialog
          wide
          title="Original transcript"
          subtitle="Unchanged source text, including speaker labels and spacing."
          close={() => setModal(null)}
        >
          <pre className="original-text">{transcript.text}</pre>
          <button
            onClick={() => download(`${transcript.name.replace(/[^a-zA-Z0-9_-]/g, '-')}.txt`, transcript.text, 'text/plain;charset=utf-8')}
          >
            <ArrowDownToLine size={16} />
            Download original text
          </button>
        </Dialog>
      )}
      {selectTurn && transcript && (
        <PassageDialog
          turn={selectTurn}
          transcript={transcript}
          close={() => setSelectTurn(null)}
          select={s => {
            pick(s);
            setSelectTurn(null);
            setTimeout(() => document.querySelector('.selection-card')?.scrollIntoView({ block: 'nearest' }), 10);
          }}
        />
      )}
      {codeDialog && project && (
        <CodeDialog
          code={codeDialog}
          project={project}
          error={error}
          close={() => setCodeDialog(null)}
          remove={() => change(p => removeCode(p, (codeDialog as Code).id), 'Code deleted.')}
          submit={async (name, description, guidance) => {
            let createdId = '';
            const ok = await change(
              p => {
                if (codeDialog === 'new') createdId = addCode(p, name, description).id;
                else {
                  if (
                    !equal(
                      p.codes.find(c => c.id === codeDialog.id),
                      codeDialog,
                    )
                  )
                    throw new Error('This code changed. Your definition draft is kept for review.');
                  renameCode(p, codeDialog.id, name, description);
                }
                Object.assign(
                  p.codes.find(c => c.id === (createdId || (codeDialog as Code).id))!,
                  guidance,
                );
              },
              codeDialog === 'new' ? 'Your code was created.' : 'Code updated.',
            );
            if (ok) {
              if (selection && createdId) setSelectedCodes(x => [...x, createdId]);
            }
            return ok;
          }}
          merge={async into => {
            if (
              codeDialog !== 'new' &&
              (await change(p => {
                if (
                  !equal(
                    p.codes.find(c => c.id === codeDialog.id),
                    codeDialog,
                  )
                )
                  throw new Error('This code changed. Review it before merging.');
                mergeCodes(p, codeDialog.id, into);
              }, 'Codes merged. Use Undo to restore them.'))
            ) {
              setCodeDialog(null);
              setSelectedCodes([]);
              setFilter('all');
            }
          }}
        />
      )}
      {memoDialog && project && (
        <MemoDialog
          project={project}
          jump={jump}
          memo={memoDialog}
          error={error}
          close={() => setMemoDialog(null)}
          remove={memoDialog === 'new' ? undefined : () => change(p => removeMemo(p, (memoDialog as Memo).id), 'Memo deleted.')}
          submit={async (title, body) => {
            const ok = await change(p => {
              const d = now();
              if (memoDialog === 'new')
                p.memos.push({
                  id: uid(),
                  title: required(title, 'Memo title'),
                  body,
                  author: 'user',
                  quoteIds: [],
                  createdAt: d,
                  updatedAt: d,
                });
              else {
                const m = p.memos.find(m => m.id === memoDialog.id);
                if (!m || !equal(m, memoDialog))
                  throw new Error('This memo changed while you were writing. Its recovered draft can be saved as a separate memo.');
                m.title = required(title, 'Memo title');
                m.body = body;
                m.updatedAt = d;
              }
            }, 'Your memo was saved.');
            return ok;
          }}
        />
      )}
    </>
  );
}

function HighlightedText({ transcript, turn, quotes, codes }: { transcript: Transcript; turn: Turn; quotes: Quote[]; codes: Code[] }) {
  const relevant = quotes.filter(q => q.turnId === turn.id);
  const bounds = [...new Set([turn.start, turn.end, ...relevant.flatMap(q => [q.start, q.end])])].sort((a, b) => a - b);
  return (
    <>
      {bounds.slice(0, -1).map((start, i) => {
        const end = bounds[i + 1];
        const covering = relevant.filter(q => q.start <= start && q.end >= end);
        const text = transcript.text.slice(start, end);
        const codeIds = [...new Set(covering.flatMap(q => q.codeIds))];
        return covering.length ? (
          <mark
            key={start}
            className={`highlight color-${codes.find(c => c.id === codeIds[0])?.color ?? 0}`}
            title={codeIds.map(id => codes.find(c => c.id === id)?.name).join(' · ')}
          >
            {text}
          </mark>
        ) : (
          <span key={start}>{text}</span>
        );
      })}
    </>
  );
}
function NewProjectDialog({ close, create, error }: { close: () => void; create: (p: Project) => Promise<boolean>; error: string }) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState('');
  return (
    <Dialog title="New project" subtitle="Transcripts, codes and notes are saved in this browser." close={close}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          try {
            await create(newProject(name));
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <Field label="Project name">
          <input
            autoFocus
            data-autofocus
            required
            maxLength={120}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Neighborhood experiences"
          />
        </Field>
        <ErrorBox error={localError || error} />
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create project
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ImportDialog({
  project,
  close,
  submit,
  error,
}: {
  project: Project;
  close: () => void;
  submit: (t: Transcript) => Promise<boolean>;
  error: string;
}) {
  const { hosted } = useWorkspaceServices();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Transcript | null>(null);
  const [localError, setLocalError] = useState('');
  const [format, setFormat] = useState('labels');
  const [busy, setBusy] = useState(false);
  const guardClose = useDraftGuard(Boolean(name || text || draft), close);
  const closeDraft = () => {
    if (!busy) guardClose();
  };
  const labels = draft ? [...new Set(draft.turns.map(t => t.label))] : [];
  function review(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    try {
      const t = makeTranscript(name, text, project.transcripts, format as 'labels' | 'lines');
      if (!t.turns.length) throw new Error('No spoken text was found. Add words after the speaker labels.');
      setDraft({ ...t, turns: guessRoles(t.turns) });
      setLocalError('');
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  return (
    <Dialog
      wide
      title={draft ? 'Who is speaking?' : 'Bring in a transcript'}
      subtitle={
        draft
          ? 'Roles are guessed from labels like Interviewer or Q. Check them: only participant turns can become quotes.'
          : hosted
            ? 'Paste text or choose a UTF-8 .txt file. If this project is shared, the people you invited will see it.'
            : 'Paste text or choose a UTF-8 .txt file. Everything stays on this device.'
      }
      close={closeDraft}
    >
      {!draft ? (
        <form onSubmit={review}>
          {project.synthetic && (
            <label className="synthetic-confirm">
              <input disabled={busy} type="checkbox" required />
              <span>This is fictional practice text. I will keep real research in a separate project.</span>
            </label>
          )}
          <label className="file-drop">
            <FileText size={24} />
            <strong>Choose a text file</strong>
            <span>Plain text (.txt) · up to 2 MB</span>
            <input
              disabled={busy}
              aria-label="Choose transcript text file"
              type="file"
              accept=".txt,text/plain"
              onChange={async e => {
                const f = e.target.files?.[0];
                if (!f || busy) return;
                setBusy(true);
                try {
                  if (!f.name.toLowerCase().endsWith('.txt')) throw new Error('Choose a plain text (.txt) file.');
                  const raw = await readTextFile(f, 2_000_000);
                  setText(raw);
                  setName(f.name.replace(/\.txt$/i, ''));
                  setLocalError('');
                } catch (e) {
                  setLocalError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <Field label="Transcript name">
            <input
              disabled={busy}
              required
              maxLength={120}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="A name you will recognize"
            />
          </Field>
          <Field label="Transcript text">
            <textarea
              disabled={busy}
              required
              rows={8}
              value={text}
              maxLength={1_000_000}
              onChange={e => setText(e.target.value)}
              placeholder={'Interviewer: What was the visit like?\nParticipant: I felt welcome as soon as I arrived.'}
            />
          </Field>
          <Field
            label="How should turns be separated?"
            hint="Speaker-label mode starts a new turn on each line that begins with a label and colon. Choose one turn per line if colons are part of the spoken text."
          >
            <select disabled={busy} value={format} onChange={e => setFormat(e.target.value)}>
              <option value="labels">Speaker labels (Speaker: words)</option>
              <option value="lines">One turn per non-empty line · keep all words</option>
            </select>
          </Field>
          <ErrorBox error={localError || error} />
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={closeDraft}>
              Cancel
            </button>
            <button disabled={busy} className="primary" type="submit">
              Review speaker roles
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="role-groups">
            {labels.map(label => (
              <Field key={label} label={`${label} · ${draft.turns.filter(t => t.label === label).length} turns`}>
                <select
                  disabled={busy}
                  aria-label={`Role for ${label}`}
                  value={draft.turns.find(t => t.label === label)!.role}
                  onChange={e =>
                    setDraft({ ...draft, turns: draft.turns.map(t => (t.label === label ? { ...t, role: e.target.value as Role } : t)) })
                  }
                >
                  {roles.map(r => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <div className="import-preview">
            {draft.turns.map((t, i) => (
              <div key={t.id}>
                <span className="eyebrow">
                  {i + 1} / {t.label} · {t.role === 'unassigned' ? roleLabel(t.role) : turnRoleLabel(t)}
                </span>
                <p>{draft.text.slice(t.start, t.end)}</p>
              </div>
            ))}
          </div>
          <p className="small muted">
            {draft.turns.filter(t => t.role === 'participant').length} participant turns ready for coding ·{' '}
            {draft.turns.filter(t => t.role === 'unassigned').length} unassigned. The original text is kept exactly as imported.
          </p>
          <ErrorBox error={localError || error} />
          {busy && (
            <p role="status" className="small muted">
              Saving your transcript…
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setDraft(null)}>
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              disabled={busy}
              className="primary"
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  await submit(draft);
                } catch (e) {
                  setLocalError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Import transcript
              <Check size={16} />
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
function RestoreDialog({
  workspace,
  close,
  submit,
  error,
}: {
  workspace: Workspace;
  close: () => void;
  submit: (p: Project) => Promise<boolean>;
  error: string;
}) {
  const [draft, setDraft] = useState<Project | null>(null);
  const [localError, setLocalError] = useState('');
  const duplicate = draft && workspace.projects.some(p => p.id === draft.id);
  return (
    <Dialog title="Open a project backup" subtitle="Restore a Margin .margin.json file. Existing projects are kept." close={close}>
      <Field label="Project backup file">
        <input
          type="file"
          accept=".json,application/json"
          onChange={async e => {
            const f = e.target.files?.[0];
            if (!f) return;
            setDraft(null);
            try {
              setDraft(importProject(await readTextFile(f, 16_000_000)));
              setLocalError('');
            } catch (e) {
              setLocalError((e as Error).message);
            }
          }}
        />
      </Field>
      {draft && (
        <div className="restore-preview">
          <h3>{draft.name}</h3>
          <p>
            {draft.transcripts.length} transcripts · {draft.codes.length} codes · {draft.quotes.length} quotes · {draft.memos.length} memos
          </p>
          {duplicate && (
            <p>
              This project already exists here. Importing a separate copy keeps both versions. Internal source and quote references are
              preserved.
            </p>
          )}
        </div>
      )}
      <ErrorBox error={localError || error} />
      <div className="dialog-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!draft}
          onClick={() => {
            if (draft) {
              const p = copy(draft);
              if (duplicate) {
                p.id = uid();
                p.name = p.name.slice(0, 112) + ' (copy)';
              }
              submit(p);
            }
          }}
        >
          {duplicate ? 'Import separate copy' : 'Import project'}
        </button>
      </div>
    </Dialog>
  );
}
function PassageDialog({
  transcript,
  turn,
  close,
  select,
}: {
  transcript: Transcript;
  turn: Turn;
  close: () => void;
  select: (s: Selection) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const body = transcript.text.slice(turn.start, turn.end);
  // Some browsers do not move a caret in readonly textareas. Keep precise keyboard
  // selection available without making the immutable source editable.
  function moveCaret(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const text = el.value;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      el.setSelectionRange(0, text.length);
      setRange({ start: 0, end: text.length });
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const backwards = el.selectionDirection === 'backward';
    const anchor = backwards ? end : start;
    let caret = backwards ? start : end;
    if (!e.shiftKey && start !== end && ['ArrowLeft', 'ArrowRight'].includes(e.key)) caret = e.key === 'ArrowLeft' ? start : end;
    else {
      const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
      const nextBreak = text.indexOf('\n', caret);
      const lineEnd = nextBreak < 0 ? text.length : nextBreak;
      if (e.key === 'Home') caret = e.ctrlKey || e.metaKey ? 0 : lineStart;
      if (e.key === 'End') caret = e.ctrlKey || e.metaKey ? text.length : lineEnd;
      if (e.key === 'ArrowLeft')
        caret = e.metaKey ? lineStart : Math.max(0, caret - (caret > 1 && /[\uDC00-\uDFFF]/.test(text[caret - 1]) ? 2 : 1));
      if (e.key === 'ArrowRight')
        caret = e.metaKey ? lineEnd : Math.min(text.length, caret + (/[\uD800-\uDBFF]/.test(text[caret]) ? 2 : 1));
      if (e.key === 'ArrowUp') {
        const previous = text.lastIndexOf('\n', Math.max(-1, lineStart - 2)) + 1;
        caret = e.metaKey || e.ctrlKey ? 0 : Math.max(0, Math.min(lineStart - 1, previous + caret - lineStart));
      }
      if (e.key === 'ArrowDown') {
        const next = text.indexOf('\n', lineEnd + 1);
        caret = e.metaKey || e.ctrlKey ? text.length : Math.min(next < 0 ? text.length : next, lineEnd + 1 + caret - lineStart);
      }
    }
    const a = e.shiftKey ? Math.min(anchor, caret) : caret;
    const b = e.shiftKey ? Math.max(anchor, caret) : caret;
    el.setSelectionRange(a, b, caret < anchor ? 'backward' : 'forward');
    setRange({ start: a, end: b });
  }
  const mappedStart = sourceOffsetFromTextarea(body, range.start);
  const mappedEnd = sourceOffsetFromTextarea(body, range.end);
  const useRange = (start: number, end: number) => {
    const a = sourceOffsetFromTextarea(body, start);
    const b = sourceOffsetFromTextarea(body, end);
    select({ transcriptId: transcript.id, turnId: turn.id, start: turn.start + a, end: turn.start + b, text: body.slice(a, b) });
  };
  return (
    <Dialog
      title="Select the exact words"
      subtitle="Use your mouse, touch selection, or Shift + Arrow keys. This text cannot be edited."
      close={close}
    >
      <Field label="Participant passage">
        <textarea
          className="passage-selector"
          autoFocus
          data-autofocus
          ref={ref}
          readOnly
          rows={8}
          value={body}
          onKeyDown={moveCaret}
          onSelect={e => setRange({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
        />
      </Field>
      <p className="small muted" role="status">
        {mappedEnd - mappedStart} source characters selected
      </p>
      <div className="dialog-actions wrap">
        <button onClick={() => useRange(0, body.length)}>Use entire turn</button>
        <button
          className="primary"
          disabled={range.start === range.end || !body.slice(mappedStart, mappedEnd).trim()}
          onClick={() => useRange(range.start, range.end)}
        >
          Use selection
          <ArrowRight size={16} />
        </button>
      </div>
    </Dialog>
  );
}
function CodeDialog({
  code,
  project,
  close,
  submit,
  merge,
  remove,
  error,
}: {
  code: Code | 'new';
  project: Project;
  close: () => void;
  submit: (name: string, description: string, guidance: Pick<Code, 'inclusion' | 'exclusion' | 'exampleQuoteIds'>) => Promise<boolean>;
  merge: (into: string) => Promise<void>;
  remove: () => Promise<boolean>;
  error: string;
}) {
  const original = code === 'new' ? null : code;
  const draft = useDurableDraft(
    { projectId: project.id, kind: 'code', label: 'Unfinished code definition', entityId: original?.id, base: original },
    {
      name: original?.name ?? '',
      description: original?.description ?? '',
      inclusion: original?.inclusion ?? '',
      exclusion: original?.exclusion ?? '',
      exampleQuoteIds: original?.exampleQuoteIds ?? [],
    },
  );
  const { name, description, inclusion, exclusion, exampleQuoteIds } = draft.value;
  const setName = (name: string) => draft.update({ ...draft.value, name }),
    setDescription = (description: string) => draft.update({ ...draft.value, description }),
    setInclusion = (inclusion: string) => draft.update({ ...draft.value, inclusion }),
    setExclusion = (exclusion: string) => draft.update({ ...draft.value, exclusion }),
    setExamples = (fn: (ids: string[]) => string[]) => draft.update({ ...draft.value, exampleQuoteIds: fn(exampleQuoteIds) });
  const [into, setInto] = useState(''),
    [busy, setBusy] = useState(false);
  const dirty = draft.dirty;
  const closeDraft = () => {
    if (!busy && (!draft.error || window.confirm('This draft could not be stored. Close and lose the unsaved writing?'))) close();
  };

  return (
    <Dialog title={code === 'new' ? 'New code' : 'Edit code'} close={closeDraft}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          if (await submit(name, description, { inclusion, exclusion, exampleQuoteIds })) {
            if (draft.clear()) close();
          }
          setBusy(false);
        }}
      >
        <Field label="Code name">
          <input
            disabled={busy}
            autoFocus
            data-autofocus
            required
            maxLength={80}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your short label"
          />
        </Field>
        <Field label="What does this code mean to you? (optional)">
          <textarea
            disabled={busy}
            maxLength={20_000}
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Write your own definition or when to use this code."
          />
        </Field>
        <details className="code-guidance">
          <summary>Add guidance & examples (optional)</summary>
          <p className="small muted">Written by you. These notes can change as your reading develops.</p>
          <Field label="Include when">
            <textarea disabled={busy} rows={3} maxLength={20_000} value={inclusion} onChange={e => setInclusion(e.target.value)} />
          </Field>
          <Field label="Exclude when">
            <textarea disabled={busy} rows={3} maxLength={20_000} value={exclusion} onChange={e => setExclusion(e.target.value)} />
          </Field>
          {original && (
            <fieldset className="link-picker">
              <legend>Example quotes chosen by you</legend>
              <div className="quote-picker">
                {project.quotes
                  .filter(q => q.codeIds.includes(original.id))
                  .map(q => (
                    <label key={q.id}>
                      <input
                        disabled={busy}
                        type="checkbox"
                        checked={exampleQuoteIds.includes(q.id)}
                        onChange={() => setExamples(ids => (ids.includes(q.id) ? ids.filter(id => id !== q.id) : [...ids, q.id]))}
                      />
                      <span>
                        <small>{project.transcripts.find(t => t.id === q.transcriptId)!.name}</small>
                        <span>{q.text}</span>
                      </span>
                    </label>
                  ))}
              </div>
              {!project.quotes.some(q => q.codeIds.includes(original.id)) && (
                <p className="small muted">Code a passage with this label to choose it as an example.</p>
              )}
            </fieldset>
          )}
        </details>
        <DraftStatus draft={draft} />
        <ErrorBox error={error} />
        <div className="dialog-actions">
          {original && (
            <button
              type="button"
              className="text-button delete-link"
              disabled={busy}
              onClick={async () => {
                const n = project.quotes.filter(q => q.codeIds.includes(original.id)).length;
                if (
                  !window.confirm(
                    `Delete the code “${original.name}”? ${n ? `Its ${plural(n, 'quote')} stay, just without this label. ` : ''}Undo brings it back.`,
                  )
                )
                  return;
                setBusy(true);
                if (await remove()) {
                  draft.clear();
                  close();
                }
                setBusy(false);
              }}
            >
              <Trash2 size={15} />
              Delete code
            </button>
          )}
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button className="primary" disabled={busy} type="submit">
            {code === 'new' ? 'Create code' : 'Save changes'}
          </button>
        </div>
      </form>
      {code !== 'new' && project.codes.length > 1 && (
        <details className="merge-section">
          <summary>
            <Merge size={16} />
            Merge into another code
          </summary>
          <p className="small muted">Its quotes move to the code you pick, and this code goes away.</p>
          <Field label="Keep this code">
            <select value={into} onChange={e => setInto(e.target.value)}>
              <option value="">Choose a destination…</option>
              {project.codes
                .filter(c => c.id !== code.id)
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <button
            disabled={!into || busy}
            onClick={async () => {
              if (dirty && !window.confirm('Merge the saved code and discard unsaved edits in this dialog?')) return;
              setBusy(true);
              await merge(into);
              setBusy(false);
            }}
          >
            Merge “{code.name}”
          </button>
        </details>
      )}
    </Dialog>
  );
}
function RolesDialog({
  transcript,
  project,
  close,
  submit,
  error,
}: {
  transcript: Transcript;
  project: Project;
  close: () => void;
  submit: (roles: Record<string, Role>) => Promise<void>;
  error: string;
}) {
  const [values, setValues] = useState<Record<string, Role>>(Object.fromEntries(transcript.turns.map(t => [t.id, t.role])));
  return (
    <Dialog
      wide
      title="Review speaker roles"
      subtitle="Roles belong to individual turns. Coded participant turns are protected until their quotes are removed."
      close={close}
    >
      <div className="role-review">
        {transcript.turns.map((t, i) => (
          <div key={t.id}>
            <Field label={`Turn ${i + 1} · ${t.label}`}>
              <select
                value={values[t.id]}
                disabled={project.quotes.some(q => q.turnId === t.id)}
                onChange={e => setValues({ ...values, [t.id]: e.target.value as Role })}
              >
                {roles.map(r => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </Field>
            <p>{transcript.text.slice(t.start, t.end)}</p>
            {project.quotes.some(q => q.turnId === t.id) && (
              <small>Coded participant evidence · remove its quotes before changing this role.</small>
            )}
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="dialog-actions">
        <button onClick={close}>Cancel</button>
        <button className="primary" onClick={() => submit(values)}>
          Save roles
        </button>
      </div>
    </Dialog>
  );
}
function MemoDialog({
  memo,
  project,
  jump,
  close,
  submit,
  remove,
  error,
}: {
  project: Project;
  jump: (q: Quote) => void;
  memo: Memo | 'new';
  close: () => void;
  submit: (title: string, body: string) => Promise<boolean>;
  remove?: () => Promise<boolean>;
  error: string;
}) {
  const original = memo === 'new' ? null : memo;
  const draft = useDurableDraft(
    {
      projectId: project.id,
      kind: 'memo',
      label: original ? 'Unfinished memo edit' : 'Unfinished memo',
      entityId: original?.id,
      base: original,
      links: original?.quoteIds,
    },
    { title: original?.title ?? '', body: original?.body ?? '' },
  );
  const { title, body } = draft.value;
  const [busy, setBusy] = useState(false);
  const setTitle = (title: string) => draft.update({ ...draft.value, title }),
    setBody = (body: string) => draft.update({ ...draft.value, body });
  const dirty = draft.dirty;
  const closeDraft = () => {
    if (
      !busy &&
      (!dirty ||
        window.confirm(
          draft.error
            ? 'This memo draft could not be stored. Download or copy it first. Close and lose the unsaved writing?'
            : 'Close this memo? Your stored draft stays in Draft recovery. Choose Cancel to keep writing.',
        ))
    )
      close();
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  return (
    <Dialog wide title={memo === 'new' ? 'Write a memo' : 'Memo'} close={closeDraft}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (busy) return;
          const submitted = { title, body };
          setBusy(true);
          try {
            if (await submit(title, body)) {
              if (draft.clear(submitted)) close();
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Memo title">
          <input
            disabled={busy}
            autoFocus
            data-autofocus
            maxLength={120}
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="A question or thought to return to"
          />
        </Field>
        <Field label="Your words">
          <textarea
            disabled={busy}
            rows={10}
            maxLength={100_000}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write what you are noticing, wondering, or deciding…"
          />
        </Field>
        {memo !== 'new' && !!memo.quoteIds.length && (
          <details>
            <summary>{memo.quoteIds.length} linked participant quotes</summary>
            {memo.quoteIds.map(id => (
              <Evidence
                key={id}
                quote={project.quotes.find(q => q.id === id)!}
                project={project}
                jump={q => {
                  if (!dirty || window.confirm('Discard unsaved memo changes and view this source?')) {
                    close();
                    jump(q);
                  }
                }}
              />
            ))}
          </details>
        )}
        <p className="small muted" role="status">
          {draft.saved ? 'Writing draft saved on this device.' : 'Your memo is saved when you choose Save memo.'}
        </p>
        <ErrorBox error={draft.error || error} />
        {draft.error && (
          <button type="button" onClick={() => download('margin-unsaved-memo.json', draft.raw())}>
            Download this writing now
          </button>
        )}
        <div className="dialog-actions">
          {original && remove && (
            <button
              type="button"
              className="text-button delete-link"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Delete the memo “${original.title}”? Undo brings it back.`)) return;
                setBusy(true);
                if (await remove()) {
                  draft.clear();
                  close();
                }
                setBusy(false);
              }}
            >
              <Trash2 size={15} />
              Delete memo
            </button>
          )}
          <button type="button" onClick={closeDraft}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className="primary">
            Save memo
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function QuoteCard({
  quote: q,
  project,
  jump,
  remove,
}: {
  quote: Quote;
  project: Project;
  jump: (q: Quote) => void;
  remove: () => Promise<boolean>;
}) {
  const t = project.transcripts.find(t => t.id === q.transcriptId)!;
  const i = t.turns.findIndex(t => t.id === q.turnId);
  return (
    <article className="quote-card">
      <div className="quote-source">
        <span>{t.name}</span>
        <span>Turn {i + 1}</span>
      </div>
      <blockquote>{q.text}</blockquote>
      <div className="quote-codes">
        {q.codeIds.map(id => {
          const c = project.codes.find(c => c.id === id)!;
          return (
            <span className={`code-tag color-${c.color}`} key={id}>
              <CodeDot color={c.color} />
              {c.name}
            </span>
          );
        })}
      </div>
      <details className="quote-context">
        <summary>Show context</summary>
        {[i - 1, i, i + 1]
          .filter(n => !!t.turns[n])
          .map(n => {
            const x = t.turns[n];
            return (
              <div key={x.id} className={n === i ? 'current-context' : ''}>
                <strong>
                  {x.label} · {roleLabel(x.role)}
                </strong>
                <p>{t.text.slice(x.start, x.end)}</p>
              </div>
            );
          })}
      </details>
      <div className="quote-card-actions">
        <button className="text-button" onClick={() => jump(q)}>
          View in transcript
          <ArrowRight size={15} />
        </button>
        <button className="text-button muted" onClick={remove}>
          Remove quote
        </button>
      </div>
    </article>
  );
}

function KeysDialog({ project, close, saved }: { project: Project; close: () => void; saved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => groupKeys(project.id, project.boardGroups));
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const used = new Set([UNGROUPED_KEY]);
    const next: Record<string, string> = {};
    for (const g of project.boardGroups) {
      const k = (values[g.id] ?? '').trim().toLowerCase();
      if (!k) continue;
      if (!/^[a-z0-9]$/.test(k)) {
        setError(`Use one letter or number for ${g.title}.`);
        return;
      }
      if (used.has(k)) {
        setError(k === UNGROUPED_KEY ? '0 is kept for Ungrouped.' : `${k.toUpperCase()} is used twice.`);
        return;
      }
      used.add(k);
      next[g.id] = k;
    }
    saveCustomKeys(project.id, next);
    saved();
    close();
  }
  return (
    <Dialog
      title="Group keys"
      subtitle="Select words in a transcript, then press a key to file them. 0 is always Ungrouped. Keys are saved on this device."
      close={close}
    >
      <form onSubmit={submit}>
        <div className="key-fields">
          {project.boardGroups.map(g => (
            <Field key={g.id} label={g.title}>
              <input
                value={values[g.id] ?? ''}
                maxLength={1}
                autoComplete="off"
                onChange={e => setValues({ ...values, [g.id]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => {
              saveCustomKeys(project.id, {});
              saved();
              close();
            }}
          >
            Reset to 1–9
          </button>
          <button className="primary" type="submit">
            Save keys
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteProjectDialog({
  project,
  unshared,
  close,
  remove,
}: {
  project: Project;
  unshared: boolean;
  close: () => void;
  remove: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const file = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'project'}.margin.json`;
  return (
    <Dialog
      title={`Delete “${project.name}”?`}
      subtitle="This removes the project from this browser: its transcripts, quotes, board, codes, memos, card notes and restore points. It cannot be undone."
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="delete-summary">
        {plural(project.transcripts.length, 'transcript')} · {plural(project.quotes.length, 'quote')} ·{' '}
        {plural(project.memos.length, 'memo')}
      </p>
      {unshared && (
        <p className="error">This project has edits that were never shared with its local live session. Deleting it here loses them.</p>
      )}
      <p className="small muted">
        {saved ? `Backup downloaded as ${file}.` : 'A backup lets you open it again later with Open a project backup.'}
      </p>
      <div className="dialog-actions wrap">
        <button
          disabled={busy}
          onClick={() => {
            download(file, exportProject(project));
            setSaved(true);
          }}
        >
          <ArrowDownToLine size={16} />
          Download a backup first
        </button>
        <button disabled={busy} data-autofocus onClick={close}>
          Cancel
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await remove();
            setBusy(false);
            if (ok) close();
          }}
        >
          <Trash2 size={16} />
          Delete project
        </button>
      </div>
    </Dialog>
  );
}

function RenameDialog({
  kind,
  name,
  close,
  submit,
  error,
}: {
  kind: 'project' | 'transcript';
  name: string;
  close: () => void;
  submit: (name: string) => Promise<boolean>;
  error: string;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={kind === 'project' ? 'Rename project' : 'Rename transcript'} close={close}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          await submit(value);
          setBusy(false);
        }}
      >
        <Field label="Name">
          <input data-autofocus required maxLength={120} value={value} onChange={e => setValue(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !value.trim() || value.trim() === name}>
            Save name
          </button>
        </div>
      </form>
    </Dialog>
  );
}
