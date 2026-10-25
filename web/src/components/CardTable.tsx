// A table that stays a table on wide screens and stacks each row into a labelled card on
// phones. Roles are explicit so the table semantics survive the display change.

import type { ReactNode } from 'react';

export interface CardRow {
  key: string;
  cells: ReactNode[];
}

export function CardTable({ head, rows, num = [], mono = [], rowHeader = false, testId }: { head: string[]; rows: CardRow[]; num?: number[]; mono?: number[]; rowHeader?: boolean; testId?: string }) {
  const cls = (i: number) => [mono.includes(i) ? 'mono' : '', num.includes(i) ? 'num' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <table className="cards" role="table" data-testid={testId}>
      <thead role="rowgroup">
        <tr role="row">
          {head.map((h, i) => (
            <th key={h} scope="col" role="columnheader" className={num.includes(i) ? 'num' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((r) => (
          <tr key={r.key} role="row">
            {r.cells.map((c, i) =>
              i === 0 && rowHeader ? (
                <th key={i} scope="row" role="rowheader" data-label={head[i]} className={cls(i)}>
                  {c}
                </th>
              ) : (
                <td key={i} role="cell" data-label={head[i]} className={cls(i)}>
                  {c}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
