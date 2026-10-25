// Panes of stamps: one sheet of 100 per pack issued under a key, spent stamps cancelled.
// Every stamp looks the same, which is the anonymity set.

const PER_SHEET = 100;
const MAX_SHEETS = 10;

export function Pane({ issued, spent, large = false, label }: { issued: number; spent: number; large?: boolean; label?: string }) {
  const sheets = Math.ceil(issued / PER_SHEET);
  const shownSheets = Math.min(sheets, MAX_SHEETS);
  const shown = Math.min(issued, shownSheets * PER_SHEET);
  const struck = Math.min(spent, shown);
  return (
    <div>
      <div className={`pane-set${large ? ' large' : ''}`} role="img" aria-label={label ?? `${issued} tokens issued under this key, ${spent} spent`} data-testid="dots">
        {Array.from({ length: shownSheets }, (_, s) => (
          <div className="pane" key={s}>
            {Array.from({ length: Math.min(PER_SHEET, shown - s * PER_SHEET) }, (_, i) => (
              <i key={i} className={s * PER_SHEET + i < struck ? 'spent' : undefined} />
            ))}
          </div>
        ))}
      </div>
      {sheets > MAX_SHEETS && (
        <p className="muted">
          Showing {MAX_SHEETS} of {sheets} sheets.
        </p>
      )}
    </div>
  );
}
