interface ConfidenceBadgeProps {
  confidence: number;
}

export default function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const label =
    confidence > 0.3 ? "HIGH" : confidence >= 0.15 ? "MED" : "LOW";

  const colors: Record<string, string> = {
    HIGH: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MED: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    LOW: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-bold rounded border ${colors[label]}`}
    >
      {label}
    </span>
  );
}
