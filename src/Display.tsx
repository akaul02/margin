import { useEffect, useRef, useState } from 'react';
import { AArrowDown, AArrowUp, Monitor, Moon, Sun } from 'lucide-react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export const TEXT_SIZES = [0.9, 1, 1.1, 1.25, 1.4];
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Display preferences only. */
  }
};

/** Theme and text size, remembered per browser. System follows the operating system's light or dark setting. */
export function useDisplay() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const saved = read('margin-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [size, setSize] = useState(() => {
    const saved = Number(read('margin-text-size'));
    return TEXT_SIZES.includes(saved) ? saved : 1;
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setSystemDark(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  const theme: 'light' | 'dark' = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    write('margin-theme', choice);
  }, [theme, choice]);
  useEffect(() => {
    document.documentElement.style.setProperty('--text-zoom', String(size));
    write('margin-text-size', String(size));
  }, [size]);
  return { choice, setChoice, theme, size, setSize };
}

const THEMES = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'System', Monitor],
] as const;

/** The header's display button: a small panel with the theme and text size. */
export function DisplayMenu({ display }: { display: ReturnType<typeof useDisplay> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>('.display-button')?.focus();
    };
    addEventListener('pointerdown', away);
    addEventListener('keydown', escape);
    return () => {
      removeEventListener('pointerdown', away);
      removeEventListener('keydown', escape);
    };
  }, [open]);
  const { choice, setChoice, theme, size, setSize } = display;
  const step = TEXT_SIZES.indexOf(size);
  const Icon = choice === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  return (
    <div className="display-menu" ref={box}>
      <button
        className="icon-button display-button"
        aria-label="Display settings"
        aria-expanded={open}
        aria-controls="display-panel"
        title="Theme and text size"
        onClick={() => setOpen(o => !o)}
      >
        <Icon size={19} />
      </button>
      {open && (
        <div className="display-panel" id="display-panel" role="group" aria-label="Display settings">
          <fieldset>
            <legend>Theme</legend>
            <div className="segmented">
              {THEMES.map(([value, label, ThemeIcon]) => (
                <label key={value} className={choice === value ? 'on' : ''}>
                  <input type="radio" name="margin-theme" value={value} checked={choice === value} onChange={() => setChoice(value)} />
                  <ThemeIcon size={15} aria-hidden="true" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Text size</legend>
            <div className="text-size">
              <button aria-label="Smaller text" disabled={step <= 0} onClick={() => setSize(TEXT_SIZES[step - 1])}>
                <AArrowDown size={18} />
              </button>
              <span aria-live="polite">{Math.round(size * 100)}%</span>
              <button aria-label="Larger text" disabled={step >= TEXT_SIZES.length - 1} onClick={() => setSize(TEXT_SIZES[step + 1])}>
                <AArrowUp size={18} />
              </button>
              {size !== 1 && (
                <button className="text-button" onClick={() => setSize(1)}>
                  Reset
                </button>
              )}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
