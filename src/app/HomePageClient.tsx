"use client";

import { useRouter, useSearchParams } from "next/navigation";
import PredictionCard from "@/components/PredictionCard";
import WeekSelector from "@/components/WeekSelector";

interface GameRow {
  id: number;
  season: number;
  week: number;
  season_type: number;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  start_time: string | null;
  venue: string | null;
  tv_network: string | null;
}

interface TeamRow {
  id: number;
  name: string;
  abbreviation: string;
  logo_url: string | null;
  color: string | null;
}

interface PredictionRow {
  game_id: number;
  predicted_winner_id: number;
  confidence: number;
  home_win_prob: number;
  away_win_prob: number;
}

interface HomePageClientProps {
  weeks: { season_type: number; week: number }[];
  selectedSeasonType: number | null;
  selectedWeek: number | null;
  games: GameRow[];
  teamMap: Record<number, TeamRow>;
  predictionMap: Record<number, PredictionRow>;
  resultMap: Record<number, boolean>;
  staleData: boolean;
  lastSyncTime: string | null;
  offSeason: boolean;
}

export default function HomePageClient({
  weeks,
  selectedSeasonType,
  selectedWeek,
  games,
  teamMap,
  predictionMap,
  resultMap,
  staleData,
  lastSyncTime,
  offSeason,
}: HomePageClientProps) {
  const router = useRouter();

  function handleWeekChange(season_type: number, week: number) {
    router.push(`/?season_type=${season_type}&week=${week}`);
  }

  if (offSeason) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">NFL Predictor</h1>
        <p className="text-[var(--text-secondary)] text-lg">
          The season hasn&apos;t started yet. Check back in September.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Stale data banner */}
      {staleData && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          Data may be outdated &mdash; last sync:{" "}
          {lastSyncTime
            ? new Date(lastSyncTime).toLocaleString()
            : "unknown"}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Weekly Predictions</h1>
        <WeekSelector
          weeks={weeks}
          selected={
            selectedSeasonType && selectedWeek
              ? { season_type: selectedSeasonType, week: selectedWeek }
              : null
          }
          onChange={handleWeekChange}
        />
      </div>

      {/* Game grid */}
      {games.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-secondary)]">
          No games found for this week.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((game) => {
            const homeTeam = teamMap[game.home_team_id];
            const awayTeam = teamMap[game.away_team_id];
            if (!homeTeam || !awayTeam) return null;

            const prediction = predictionMap[game.id] ?? null;
            const result = game.status === "final"
              ? (resultMap[game.id] != null ? { correct: resultMap[game.id] } : null)
              : null;

            return (
              <PredictionCard
                key={game.id}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
                startTime={game.start_time}
                tvNetwork={game.tv_network}
                venue={game.venue}
                prediction={prediction}
                result={result}
                homeScore={game.home_score}
                awayScore={game.away_score}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
