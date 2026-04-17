"use client";

interface PredictionDetail {
  game_id: number;
  predicted_winner_id: number;
  confidence: number;
  home_win_prob: number;
  away_win_prob: number;
}

interface ResultRow {
  id: string;
  correct: boolean;
  scored_at: string;
  actual_winner_id: number;
  predictions: unknown;
}

interface GameDetail {
  id: number;
  week: number;
  season_type: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  start_time: string | null;
}

interface TeamInfo {
  id: number;
  name: string;
  abbreviation: string;
}

interface AccuracyTableProps {
  results: ResultRow[];
  gameMap: Record<number, GameDetail>;
  teamMap: Record<number, TeamInfo>;
}

export default function AccuracyTable({
  results,
  gameMap,
  teamMap,
}: AccuracyTableProps) {
  if (results.length === 0) {
    return (
      <div className="text-[var(--text-secondary)] text-sm">
        No scored predictions yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[var(--text-secondary)]">
            <th className="text-left py-2 px-3">Week</th>
            <th className="text-left py-2 px-3">Matchup</th>
            <th className="text-left py-2 px-3">Predicted</th>
            <th className="text-left py-2 px-3">Score</th>
            <th className="text-left py-2 px-3">Result</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const pred = r.predictions as PredictionDetail | null;
            if (!pred?.game_id) return null;

            const game = gameMap[pred.game_id];
            if (!game) return null;

            const homeTeam = teamMap[game.home_team_id];
            const awayTeam = teamMap[game.away_team_id];
            const predictedTeam = teamMap[pred.predicted_winner_id];

            const weekLabel =
              game.season_type === 3
                ? ["WC", "DIV", "CONF", "SB"][game.week - 1] ?? `P${game.week}`
                : `Wk ${game.week}`;

            return (
              <tr
                key={r.id}
                className="border-b border-white/5 hover:bg-white/[0.02]"
              >
                <td className="py-2 px-3">{weekLabel}</td>
                <td className="py-2 px-3">
                  {homeTeam?.abbreviation ?? "???"} vs{" "}
                  {awayTeam?.abbreviation ?? "???"}
                </td>
                <td className="py-2 px-3">
                  {predictedTeam?.abbreviation ?? "???"}
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">
                    ({(pred.confidence * 100).toFixed(0)}% conf)
                  </span>
                </td>
                <td className="py-2 px-3">
                  {game.home_score ?? "-"} - {game.away_score ?? "-"}
                </td>
                <td className="py-2 px-3">
                  <span
                    className={
                      r.correct
                        ? "text-[var(--accent-green)] font-bold"
                        : "text-[var(--accent-red)] font-bold"
                    }
                  >
                    {r.correct ? "✓" : "✗"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
