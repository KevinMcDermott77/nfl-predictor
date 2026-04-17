"use client";

interface WeekAccuracy {
  week: number;
  season_type: number;
  correct: number;
  total: number;
}

interface AccuracyChartProps {
  data: WeekAccuracy[];
}

function weekLabel(seasonType: number, week: number): string {
  if (seasonType === 3) {
    const labels: Record<number, string> = {
      1: "WC",
      2: "DIV",
      3: "CONF",
      4: "SB",
    };
    return labels[week] ?? `P${week}`;
  }
  return `${week}`;
}

export default function AccuracyChart({ data }: AccuracyChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-[var(--text-secondary)] text-sm">
        No prediction data yet
      </div>
    );
  }

  const maxPct = 100;

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = d.total > 0 ? (d.correct / d.total) * 100 : 0;
        return (
          <div key={`${d.season_type}-${d.week}`} className="flex items-center gap-3">
            <span className="w-10 text-right text-xs text-[var(--text-secondary)]">
              {weekLabel(d.season_type, d.week)}
            </span>
            <div className="flex-1 h-6 bg-white/5 rounded overflow-hidden relative">
              <div
                className="h-full bg-[var(--accent-green)]/80 transition-all duration-500 rounded"
                style={{ width: `${(pct / maxPct) * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-[var(--text-primary)]">
                {d.correct}/{d.total} ({pct.toFixed(0)}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
