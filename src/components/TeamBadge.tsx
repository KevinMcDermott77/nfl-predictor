interface TeamBadgeProps {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
  color?: string | null;
}

export default function TeamBadge({
  name,
  abbreviation,
  logoUrl,
  color,
}: TeamBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name}
          className="w-10 h-10 object-contain"
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: color ?? "#555" }}
        >
          {abbreviation}
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {name}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
          {abbreviation}
        </span>
      </div>
    </div>
  );
}
