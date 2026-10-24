// The anonymity set: one dot per token issued under a key, spent ones dimmed. Every dot
// looks the same, which is the point.

const MAX_DOTS = 1000;

export function Dots({ issued, spent }: { issued: number; spent: number }) {
  const shown = Math.min(issued, MAX_DOTS);
  const dim = Math.min(spent, shown);
  return (
    <div>
      <div className="dots" role="img" aria-label={`${issued} tokens issued under this key, ${spent} spent`} data-testid="dots">
        {Array.from({ length: shown }, (_, i) => (
          <i key={i} className={i < dim ? 'spent' : undefined} />
        ))}
      </div>
      {issued > MAX_DOTS && <p className="muted">Showing {MAX_DOTS} of {issued}.</p>}
    </div>
  );
}
