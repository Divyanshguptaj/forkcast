interface Props {
  percent: number;
  mock?: boolean;
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function MatchRing({ percent, mock = false }: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div role="img" aria-label={`${clamped} percent match${mock ? " (demo)" : ""}`} className="relative size-[72px]">
      <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={RADIUS} fill="none" strokeWidth="6" className="stroke-line" />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
          className="stroke-basil"
        />
      </svg>
      <span className="tabular absolute inset-0 flex flex-col items-center justify-center leading-none" aria-hidden="true">
        <span className="text-lg font-bold">{clamped}%</span>
        <span className="mt-0.5 font-sans text-[9px] font-bold uppercase tracking-wider text-muted">match</span>
      </span>
    </div>
  );
}
