import { ArrowRight } from 'lucide-react';
import { type Project, type Quote } from './model';
import { CodeDot } from './ui';
import { roleLabel } from './format';

export function QuoteCard({
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
