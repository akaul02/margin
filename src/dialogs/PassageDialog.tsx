import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { sourceOffsetFromTextarea, type Transcript, type Turn } from '../model';
import { Dialog, Field } from '../ui';
import { type Selection } from '../format';

export function PassageDialog({
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
