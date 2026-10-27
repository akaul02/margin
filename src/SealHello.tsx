import { useEffect, useRef, useState } from 'react';
import { calm, lookAt, SEAL_SVG } from './seal';

const GREETED = 'margin-seal-hello';
const greeted = () => {
  try {
    return localStorage.getItem(GREETED) === '1';
  } catch {
    return true;
  }
};
/** Ceal only says hello once per browser; starting or declining the tour both count. */
export const markGreeted = () => {
  try {
    localStorage.setItem(GREETED, '1');
  } catch {
    /* Convenience only. */
  }
};

/** On a first visit, Ceal pops up on Home and offers the tour. */
export function SealHello({ start }: { start: () => void }) {
  const [shown, setShown] = useState(() => !greeted()),
    [leaving, setLeaving] = useState(false);
  const figure = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const follow = (e: PointerEvent) => figure.current && lookAt(figure.current, e.clientX, e.clientY);
    addEventListener('pointermove', follow, { passive: true });
    return () => removeEventListener('pointermove', follow);
  }, [shown]);
  if (!shown) return null;
  return (
    <section className={`seal-hello${leaving ? ' leaving' : ''}`} aria-label="Tour guide">
      <div
        className="seal seal-hello-figure"
        data-mood={leaving ? 'wave' : 'hello'}
        ref={figure}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: SEAL_SVG }}
      />
      <div className="seal-hello-bubble">
        <p>
          <strong>Hi, I’m Ceal!</strong> New here? I’ll show you around a practice interview. It takes about a minute.
        </p>
        <div className="seal-hello-actions">
          <button
            className="primary"
            onClick={() => {
              markGreeted();
              start();
            }}
          >
            Show me around
          </button>
          <button
            className="text-button"
            onClick={() => {
              markGreeted();
              setLeaving(true);
              setTimeout(() => setShown(false), calm() ? 0 : 700);
            }}
          >
            No thanks
          </button>
        </div>
      </div>
    </section>
  );
}
