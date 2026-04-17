import { supabase } from "@/lib/supabase";
import AccuracyChart from "@/components/AccuracyChart";
import AccuracyTable from "./AccuracyTable";

export const revalidate = 300;

export default async function AccuracyPage() {
  // Detect the current season from the database
  const { data: seasonData } = await supabase
    .from("games")
    .select("season")
    .order("season", { ascending: false })
    .limit(1);
  const year = seasonData?.[0]?.season ?? new Date().getFullYear();

  // Fetch all scored predictions for the season
  const { data: results } = await supabase
    .from("prediction_results")
    .select(
      "id, correct, scored_at, prediction_id, actual_winner_id, predictions(game_id, predicted_winner_id, confidence, home_win_prob, away_win_prob, reasoning)"
    )
    .order("scored_at", { ascending: false });

  // Fetch game details for the results
  const gameIds =
    results
      ?.map((r) => {
        const pred = r.predictions as unknown as { game_id: number } | null;
        return pred?.game_id;
      })
      .filter((id): id is number => id != null) ?? [];

  const { data: games } = await supabase
    .from("games")
    .select("id, week, season_type, home_team_id, away_team_id, home_score, away_score, start_time")
    .in("id", gameIds.length > 0 ? gameIds : [0]);

  const gameMap = new Map(
    (games ?? []).map((g) => [g.id, g])
  );

  // Fetch teams
  const { data: teams } = await supabase.from("teams").select("*");
  const teamMap = new Map((teams ?? []).map((t) => [t.id, t]));

  // Compute overall accuracy
  const allResults = results ?? [];
  const correctCount = allResults.filter((r) => r.correct).length;
  const totalCount = allResults.length;
  const overallPct = totalCount > 0 ? ((correctCount / totalCount) * 100).toFixed(1) : "0.0";

  // Compute weekly accuracy
  const weeklyMap = new Map<
    string,
    { week: number; season_type: number; correct: number; total: number }
  >();

  for (const r of allResults) {
    const pred = r.predictions as unknown as { game_id: number } | null;
    if (!pred?.game_id) continue;
    const game = gameMap.get(pred.game_id);
    if (!game) continue;

    const key = `${game.season_type}-${game.week}`;
    const existing = weeklyMap.get(key);
    if (existing) {
      existing.total++;
      if (r.correct) existing.correct++;
    } else {
      weeklyMap.set(key, {
        week: game.week,
        season_type: game.season_type,
        correct: r.correct ? 1 : 0,
        total: 1,
      });
    }
  }

  const weeklyData = [...weeklyMap.values()].sort(
    (a, b) => a.season_type - b.season_type || a.week - b.week
  );

  // Confidence calibration
  const highResults = allResults.filter((r) => {
    const pred = r.predictions as unknown as { confidence: number } | null;
    return pred && pred.confidence > 0.3;
  });
  const medResults = allResults.filter((r) => {
    const pred = r.predictions as unknown as { confidence: number } | null;
    return pred && pred.confidence >= 0.15 && pred.confidence <= 0.3;
  });
  const lowResults = allResults.filter((r) => {
    const pred = r.predictions as unknown as { confidence: number } | null;
    return pred && pred.confidence < 0.15;
  });

  function pct(arr: typeof allResults) {
    if (arr.length === 0) return "N/A";
    return ((arr.filter((r) => r.correct).length / arr.length) * 100).toFixed(1) + "%";
  }

  // Check off-season
  const { data: weekData } = await supabase
    .from("games")
    .select("id")
    .eq("season", year)
    .limit(1);

  if (!weekData || weekData.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Accuracy Tracker</h1>
        <p className="text-[var(--text-secondary)] text-lg">
          Last season&apos;s data will appear here when available.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Accuracy Tracker</h1>

      {/* Season stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--bg-card)] border border-white/5 rounded-xl p-5">
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Overall Accuracy
          </div>
          <div className="text-3xl font-bold">
            {correctCount}/{totalCount} &mdash; {overallPct}%
          </div>
        </div>
        <div className="bg-[var(--bg-card)] border border-white/5 rounded-xl p-5">
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Confidence Calibration
          </div>
          <div className="space-y-1 text-sm">
            <div>
              HIGH: {pct(highResults)} ({highResults.length} picks)
            </div>
            <div>
              MED: {pct(medResults)} ({medResults.length} picks)
            </div>
            <div>
              LOW: {pct(lowResults)} ({lowResults.length} picks)
            </div>
          </div>
        </div>
        <div className="bg-[var(--bg-card)] border border-white/5 rounded-xl p-5">
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Total Predictions
          </div>
          <div className="text-3xl font-bold">{totalCount}</div>
        </div>
      </div>

      {/* Weekly chart */}
      <div className="bg-[var(--bg-card)] border border-white/5 rounded-xl p-5 mb-8">
        <h2 className="text-lg font-semibold mb-4">Accuracy by Week</h2>
        <AccuracyChart data={weeklyData} />
      </div>

      {/* Prediction table */}
      <div className="bg-[var(--bg-card)] border border-white/5 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-4">All Predictions</h2>
        <AccuracyTable
          results={allResults}
          gameMap={Object.fromEntries(gameMap)}
          teamMap={Object.fromEntries(teamMap)}
        />
      </div>
    </div>
  );
}
