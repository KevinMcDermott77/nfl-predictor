import { supabase } from "@/lib/supabase";
import PredictionCard from "@/components/PredictionCard";
import WeekSelector from "@/components/WeekSelector";
import HomePageClient from "./HomePageClient";

export const revalidate = 300;

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

interface ResultRow {
  prediction_id: number;
  correct: boolean;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ season_type?: string; week?: string }>;
}) {
  const params = await searchParams;

  // Detect the current season from the database (ESPN season may differ from calendar year)
  const { data: seasonData } = await supabase
    .from("games")
    .select("season")
    .order("season", { ascending: false })
    .limit(1);
  const year = seasonData?.[0]?.season ?? new Date().getFullYear();

  // Fetch teams
  const { data: teams } = await supabase.from("teams").select("*");
  const teamMap = new Map<number, TeamRow>();
  if (teams) {
    for (const t of teams) teamMap.set(t.id, t);
  }

  // Determine selected week
  let selectedSeasonType = params.season_type ? parseInt(params.season_type) : null;
  let selectedWeek = params.week ? parseInt(params.week) : null;

  // Fetch available weeks
  const { data: weekData } = await supabase
    .from("games")
    .select("season_type, week")
    .eq("season", year)
    .order("season_type")
    .order("week");

  const weeks = weekData
    ? [...new Map(weekData.map((w: { season_type: number; week: number }) => [`${w.season_type}-${w.week}`, w])).values()]
    : [];

  // Auto-detect current week if not specified
  if (!selectedSeasonType || !selectedWeek) {
    // First try: next scheduled week
    const { data: nextWeek } = await supabase
      .from("games")
      .select("season_type, week")
      .eq("season", year)
      .eq("status", "scheduled")
      .order("season_type")
      .order("week")
      .limit(1);

    if (nextWeek && nextWeek.length > 0) {
      selectedSeasonType = nextWeek[0].season_type;
      selectedWeek = nextWeek[0].week;
    } else {
      // No scheduled games — show the latest week with finalized games
      const { data: latestFinal } = await supabase
        .from("games")
        .select("season_type, week")
        .eq("season", year)
        .eq("status", "final")
        .order("season_type", { ascending: false })
        .order("week", { ascending: false })
        .limit(1);

      if (latestFinal && latestFinal.length > 0) {
        selectedSeasonType = latestFinal[0].season_type;
        selectedWeek = latestFinal[0].week;
      } else if (weeks.length > 0) {
        const last = weeks[weeks.length - 1];
        selectedSeasonType = last.season_type;
        selectedWeek = last.week;
      }
    }
  }

  // Fetch games for selected week
  let games: GameRow[] = [];
  if (selectedSeasonType && selectedWeek) {
    const { data: gameData } = await supabase
      .from("games")
      .select("*")
      .eq("season", year)
      .eq("season_type", selectedSeasonType)
      .eq("week", selectedWeek)
      .order("start_time");
    games = (gameData ?? []) as GameRow[];
  }

  // Fetch predictions for these games
  const gameIds = games.map((g) => g.id);
  const predictionMap = new Map<number, PredictionRow>();
  const resultMap = new Map<number, boolean>();

  if (gameIds.length > 0) {
    const { data: predictions } = await supabase
      .from("predictions")
      .select("id, game_id, predicted_winner_id, confidence, home_win_prob, away_win_prob")
      .in("game_id", gameIds);
    if (predictions) {
      for (const p of predictions) predictionMap.set(p.game_id, p);
    }

    // Fetch results for scored predictions
    if (predictions && predictions.length > 0) {
      const predIds = predictions.map((p) => p.id);
      const { data: results } = await supabase
        .from("prediction_results")
        .select("correct, predictions(game_id)")
        .in("prediction_id", predIds);
      if (results) {
        for (const r of results) {
          const pred = r.predictions as unknown as { game_id: number };
          if (pred?.game_id) resultMap.set(pred.game_id, r.correct);
        }
      }
    }
  }

  // Check for stale data
  const { data: lastSync } = await supabase
    .from("sync_log")
    .select("run_at")
    .eq("step", "sync_run")
    .eq("status", "success")
    .order("run_at", { ascending: false })
    .limit(1);

  const staleData =
    lastSync &&
    lastSync.length > 0 &&
    Date.now() - new Date(lastSync[0].run_at).getTime() > 24 * 60 * 60 * 1000;

  // Off-season check
  const offSeason = weeks.length === 0;

  return (
    <HomePageClient
      weeks={weeks}
      selectedSeasonType={selectedSeasonType}
      selectedWeek={selectedWeek}
      games={games}
      teamMap={Object.fromEntries(teamMap)}
      predictionMap={Object.fromEntries(predictionMap)}
      resultMap={Object.fromEntries(resultMap)}
      staleData={!!staleData}
      lastSyncTime={lastSync?.[0]?.run_at ?? null}
      offSeason={offSeason}
    />
  );
}
