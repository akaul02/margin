import { useEffect, useRef, useId, cloneElement, isValidElement, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  // Clicking the dimmed backdrop closes, but a drag that starts inside (e.g. selecting text) does not.
  const pressedOutside = useRef(false);
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  useEffect(() => {
    const d = ref.current!;
    const previous = document.activeElement as HTMLElement;
    d.showModal();
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      d.close();
      if (previous?.isConnected) previous.focus();
      else document.getElementById('main')?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'wide' : ''}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? `${titleId}-description` : undefined}
      onCancel={e => {
        e.preventDefault();
        closeRef.current();
      }}
      onMouseDown={e => {
        pressedOutside.current = onBackdrop(e);
      }}
      onClick={e => {
        if (pressedOutside.current && onBackdrop(e)) closeRef.current();
        pressedOutside.current = false;
      }}
    >
      <div className="dialog-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={`${titleId}-description`}>{subtitle}</p>}
        </div>
        <button type="button" className="icon-button" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const hintId = useId();
  const child = isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  return (
    <label className="field">
      <span>{label}</span>
      {child
        ? cloneElement(child, {
            'aria-label': child.props['aria-label'] ?? label,
            'aria-describedby': hint ? hintId : child.props['aria-describedby'],
          })
        : children}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
export function CodeDot({ color }: { color: number }) {
  return <span aria-hidden="true" className={`code-dot color-${color}`} />;
}
