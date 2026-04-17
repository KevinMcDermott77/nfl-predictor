"use client";

interface WeekOption {
  season_type: number;
  week: number;
}

interface WeekSelectorProps {
  weeks: WeekOption[];
  selected: { season_type: number; week: number } | null;
  onChange: (season_type: number, week: number) => void;
}

function weekLabel(seasonType: number, week: number): string {
  if (seasonType === 3) {
    const labels: Record<number, string> = {
      1: "Wild Card",
      2: "Divisional",
      3: "Conference",
      4: "Super Bowl",
    };
    return labels[week] ?? `Playoff Wk ${week}`;
  }
  return `Week ${week}`;
}

export default function WeekSelector({
  weeks,
  selected,
  onChange,
}: WeekSelectorProps) {
  if (weeks.length === 0) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">
        No weeks available
      </div>
    );
  }

  return (
    <select
      className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
      value={
        selected
          ? `${selected.season_type}-${selected.week}`
          : ""
      }
      onChange={(e) => {
        const [st, w] = e.target.value.split("-").map(Number);
        onChange(st, w);
      }}
    >
      {weeks.map((w) => (
        <option
          key={`${w.season_type}-${w.week}`}
          value={`${w.season_type}-${w.week}`}
        >
          {weekLabel(w.season_type, w.week)}
        </option>
      ))}
    </select>
  );
}
