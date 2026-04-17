interface ProbabilityBarProps {
  homeWinProb: number;
  awayWinProb: number;
  homeAbbr: string;
  awayAbbr: string;
}

export default function ProbabilityBar({
  homeWinProb,
  awayWinProb,
  homeAbbr,
  awayAbbr,
}: ProbabilityBarProps) {
  const homePct = Math.round(homeWinProb * 100);
  const awayPct = Math.round(awayWinProb * 100);

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
        <span>
          {homeAbbr} {homePct}%
        </span>
        <span>
          {awayPct}% {awayAbbr}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--bg-card)]">
        <div
          className="bg-[var(--accent-green)] transition-all duration-500"
          style={{ width: `${homePct}%` }}
        />
        <div
          className="bg-[var(--accent-red)] transition-all duration-500"
          style={{ width: `${awayPct}%` }}
        />
      </div>
    </div>
  );
}
