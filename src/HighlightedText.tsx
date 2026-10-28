import { type Code, type Quote, type Transcript, type Turn } from './model';

export function HighlightedText({
  transcript,
  turn,
  quotes,
  codes,
}: {
  transcript: Transcript;
  turn: Turn;
  quotes: Quote[];
  codes: Code[];
}) {
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
