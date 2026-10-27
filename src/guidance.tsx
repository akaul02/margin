import { useState } from 'react';
import { X } from 'lucide-react';
import type { BoardGroup, Project } from './model';

/* Just-in-time tips. Each step shows only once the project reaches it and
   disappears when the step is done or dismissed. Dismissals are a per-device
   preference, so they live in localStorage rather than in the shared project. */
export type TipId = 'import' | 'select' | 'group' | 'file' | 'memo';
export type TipView = 'board' | 'read' | 'quotes' | 'memos' | 'workbench';
const steps: { id: TipId; views: TipView[]; text: string; done: (p: Project) => boolean }[] = [
  {
    id: 'import',
    views: ['board', 'read', 'quotes', 'memos'],
    text: 'Start by importing an interview transcript: open Transcripts, then Import transcript. Paste the text or choose a .txt file.',
    done: p => p.transcripts.length > 0,
  },
  {
    id: 'select',
    views: ['read'],
    text: 'Highlight a participant’s words to turn them into a quote card. Interviewer lines stay as context.',
    done: p => p.quotes.length > 0,
  },
  {
    id: 'group',
    views: ['read', 'board'],
    text: 'Make a group for each pattern you notice. Each group gets a number key.',
    done: p => p.boardGroups.length > 0,
  },
  {
    id: 'file',
    views: ['read'],
    text: 'Select words and press a group’s number key to file the quote straight into that group. You stay in the transcript.',
    done: p => p.boardGroups.some(g => g.quoteIds.length > 0),
  },
  {
    id: 'memo',
    views: ['board', 'memos'],
    text: 'When a group starts to say something, write a memo about it. Memos stay separate from participants’ words.',
    done: p => p.memos.length > 0,
  },
];
const tipsKey = (projectId: string) => `margin-tips:${projectId}`;
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Tips are a convenience; losing them never affects project data. */
  }
}

export function useTips(project: Project | null, view: TipView) {
  const [dismissed, setDismissed] = useState<Record<string, string[]>>({});
  const [off, setOff] = useState(() => readJSON('margin-tips-off', false));
  if (!project || off) return { current: null, dismiss: () => {}, turnOff: () => {} };
  const gone = dismissed[project.id] ?? readJSON<string[]>(tipsKey(project.id), []);
  const index = steps.findIndex(s => !s.done(project) && !gone.includes(s.id));
  const step = index >= 0 && steps[index].views.includes(view) ? steps[index] : null;
  return {
    current: step && { id: step.id, text: step.text, number: index + 1, total: steps.length },
    dismiss: (id: TipId) => {
      const next = [...gone, id];
      writeJSON(tipsKey(project.id), next);
      setDismissed(d => ({ ...d, [project.id]: next }));
    },
    turnOff: () => {
      writeJSON('margin-tips-off', true);
      setOff(true);
    },
  };
}
export function forgetProjectPrefs(projectId: string) {
  try {
    localStorage.removeItem(tipsKey(projectId));
    localStorage.removeItem(keysKey(projectId));
  } catch {
    /* Preferences only. */
  }
}
export function turnTipsBackOn() {
  writeJSON('margin-tips-off', false);
}

export function Tip({
  tip,
  dismiss,
  turnOff,
}: {
  tip: { id: TipId; text: string; number: number; total: number };
  dismiss: (id: TipId) => void;
  turnOff: () => void;
}) {
  return (
    <aside className="tip" aria-label={`Tip ${tip.number} of ${tip.total}`}>
      <div>
        <span className="tip-count">
          Tip {tip.number} of {tip.total}
        </span>
        <p>{tip.text}</p>
        <button className="text-button" onClick={turnOff}>
          Turn off tips
        </button>
      </div>
      <button className="icon-button" aria-label="Dismiss tip" onClick={() => dismiss(tip.id)}>
        <X size={18} />
      </button>
    </aside>
  );
}

/* Keyboard filing. 0 is always Ungrouped; groups take 1–9 in board order
   unless the reader picks their own key on this device. */
export const UNGROUPED_KEY = '0';
const keysKey = (projectId: string) => `margin-keys:${projectId}`;
export function readCustomKeys(projectId: string) {
  return readJSON<Record<string, string>>(keysKey(projectId), {});
}
export function saveCustomKeys(projectId: string, keys: Record<string, string>) {
  writeJSON(keysKey(projectId), keys);
}
export function groupKeys(projectId: string, groups: BoardGroup[], custom = readCustomKeys(projectId)): Record<string, string> {
  const result: Record<string, string> = {};
  const taken = new Set<string>([UNGROUPED_KEY]);
  for (const g of groups) {
    const k = custom[g.id];
    if (k && !taken.has(k)) {
      result[g.id] = k;
      taken.add(k);
    }
  }
  let next = 1;
  for (const g of groups) {
    if (result[g.id]) continue;
    while (next <= 9 && taken.has(String(next))) next++;
    if (next > 9) break;
    result[g.id] = String(next);
    taken.add(String(next));
  }
  return result;
}
export function Kbd({ k }: { k?: string }) {
  return k ? <kbd className="key">{k.toUpperCase()}</kbd> : null;
}
