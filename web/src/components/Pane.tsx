// A pane of stamps: one per token issued under a key. Spent ones are struck through. Every
// stamp looks the same, which is the anonymity set.

const MAX = 1000;

export function Pane({ issued, spent, dev = false, label }: { issued: number; spent: number; dev?: boolean; label?: string }) {
  const shown = Math.min(issued, MAX);
  const struck = Math.min(spent, shown);
  return (
    <div>
      <div className={`pane${dev ? ' dev' : ''}`} role="img" aria-label={label ?? `${issued} tokens issued under this key, ${spent} spent`} data-testid="dots">
        {Array.from({ length: shown }, (_, i) => (
          <i key={i} className={i < struck ? 'spent' : undefined} />
        ))}
      </div>
      {issued > MAX && <p className="muted">Showing {MAX} of {issued}.</p>}
    </div>
  );
}
