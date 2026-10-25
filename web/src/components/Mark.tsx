// The Fare mark: a perforated stamp holding the two dots (one filled, one outlined).

export function Mark() {
  const holes = [];
  for (let i = 0; i < 6; i++) {
    const t = 3 + i * 4.8;
    holes.push(<circle key={`t${i}`} cx={t} cy={1.2} r={1.25} />, <circle key={`b${i}`} cx={t} cy={28.8} r={1.25} />);
    holes.push(<circle key={`l${i}`} cx={1.2} cy={t} r={1.25} />, <circle key={`r${i}`} cx={28.8} cy={t} r={1.25} />);
  }
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <mask id="fare-mark-perf">
        <rect width="30" height="30" fill="#fff" />
        <g fill="#000">{holes}</g>
      </mask>
      <rect width="30" height="30" fill="currentColor" mask="url(#fare-mark-perf)" />
      <circle cx="10.5" cy="15" r="4" fill="var(--mark-dot, var(--paper))" />
      <circle cx="19.5" cy="15" r="3.3" fill="none" stroke="var(--mark-dot, var(--paper))" strokeWidth="1.4" />
    </svg>
  );
}
