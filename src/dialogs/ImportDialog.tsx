import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText } from 'lucide-react';
import { guessRoles, turnRoleLabel, makeTranscript, readTextFile, type Project, type Role, type Transcript } from '../model';
import { ErrorBox, Dialog, Field } from '../ui';
import { useDraftGuard } from '../Workbench';
import { useWorkspaceServices } from '../WorkspaceContext';
import { roles, roleLabel } from '../format';

export function ImportDialog({
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
