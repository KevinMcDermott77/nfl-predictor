import { createServiceClient } from "./supabase";
import {
  fetchEspnTeams,
  fetchEspnScoreboard,
  fetchCurrentSeason,
  extractWeek,
  mapEspnStatus,
  EspnTeam,
  EspnGame,
} from "./espn";
import { predictGame, blendStats, TeamStatsInput } from "./predictions";
import type { SupabaseClient } from "@supabase/supabase-js";

type DbClient = SupabaseClient;

// --- Logging ---

async function logStep(db: DbClient, step: string, status: string, message?: string) {
  try {
    await db.from("sync_log").insert({ step, status, message: message ?? null });
  } catch {
    // Don't let logging failures crash the sync
  }
}

// --- Concurrency control ---

async function acquireSyncLock(db: DbClient): Promise<boolean> {
  const { data } = await db
    .from("sync_log")
    .select("id, run_at")
    .eq("step", "sync_run")
    .eq("status", "running")
    .order("run_at", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const runAt = new Date(data[0].run_at);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    if (runAt > thirtyMinutesAgo) return false;
  }

  await db.from("sync_log").insert({ step: "sync_run", status: "running" });
  return true;
}

async function releaseSyncLock(db: DbClient, status: "success" | "error") {
  const { data } = await db
    .from("sync_log")
    .select("id")
    .eq("step", "sync_run")
    .eq("status", "running")
    .order("run_at", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    await db.from("sync_log").update({ status }).eq("id", data[0].id);
  }
}

// --- No-op optimization ---

async function shouldSkip(db: DbClient): Promise<boolean> {
  // Check if any games are in_progress
  const { data: inProgress } = await db
    .from("games")
    .select("id")
    .eq("status", "in_progress")
    .limit(1);
  if (inProgress && inProgress.length > 0) return false;

  // Check last successful sync
  const { data: lastSync } = await db
    .from("sync_log")
    .select("run_at")
    .eq("step", "sync_run")
    .eq("status", "success")
    .order("run_at", { ascending: false })
    .limit(1);

  if (lastSync && lastSync.length > 0) {
    const lastRun = new Date(lastSync[0].run_at);
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { data: upcoming } = await db
      .from("games")
      .select("id")
      .eq("status", "scheduled")
      .lt("start_time", tomorrow.toISOString())
      .limit(1);

    if (lastRun > fourHoursAgo && (!upcoming || upcoming.length === 0)) {
      return true;
    }
  }

  return false;
}

// --- Retry helper ---

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
  throw new Error("unreachable");
}

// --- Step 1: Sync teams ---

async function syncTeams(db: DbClient): Promise<boolean> {
  try {
    const teams = await withRetry(() => fetchEspnTeams());

    const rows = teams.map((t: EspnTeam) => ({
      id: parseInt(t.id),
      name: t.displayName || t.name,
      abbreviation: t.abbreviation,
      location: t.location,
      mascot: t.name,
      logo_url: t.logos?.[0]?.href ?? null,
      color: t.color || null,
    }));

    const { error } = await db.from("teams").upsert(rows, { onConflict: "id" });
    if (error) throw error;

    await logStep(db, "teams", "success", `Synced ${rows.length} teams`);
    return true;
  } catch (err) {
    await logStep(db, "teams", "error", String(err));
    return false;
  }
}

// --- Step 2: Sync schedule ---

async function syncSchedule(db: DbClient) {
  // Detect current ESPN season (may differ from calendar year during playoffs/offseason)
  const year = await fetchCurrentSeason();
  await logStep(db, "schedule", "info", `ESPN current season: ${year}`);
  let totalGames = 0;

  for (let week = 1; week <= 18; week++) {
    try {
      const result = await fetchEspnScoreboard(week, 2);
      await upsertGames(db, result.events, result.seasonYear ?? year);
      totalGames += result.events.length;
    } catch (err) {
      await logStep(db, "games", "error", `Week ${week} regular: ${err}`);
    }
  }

  for (let week = 1; week <= 5; week++) {
    try {
      const result = await fetchEspnScoreboard(week, 3);
      if (result.events.length === 0) break;
      await upsertGames(db, result.events, result.seasonYear ?? year);
      totalGames += result.events.length;
    } catch (err) {
      await logStep(db, "games", "error", `Week ${week} postseason: ${err}`);
    }
  }

  await logStep(db, "games", "success", `Processed ${totalGames} games for season ${year}`);
}

async function upsertGames(db: DbClient, games: EspnGame[], season: number) {
  for (const game of games) {
    try {
      const competitions = game.competitions?.[0];
      if (!competitions) continue;

      const homeComp = competitions.competitors?.find(
        (c) => c.homeAway === "home"
      );
      const awayComp = competitions.competitors?.find(
        (c) => c.homeAway === "away"
      );
      if (!homeComp || !awayComp) continue;

      const status = mapEspnStatus(game.status.type.name);
      const row: Record<string, unknown> = {
        id: parseInt(game.id),
        season,
        week: extractWeek(game.week),
        season_type: game.seasonType ?? 2,
        status,
        home_team_id: parseInt(homeComp.team.id),
        away_team_id: parseInt(awayComp.team.id),
        home_score: homeComp.score ? parseInt(homeComp.score) : null,
        away_score: awayComp.score ? parseInt(awayComp.score) : null,
        start_time: game.date ? new Date(game.date).toISOString() : null,
        venue: competitions.venue?.fullName ?? null,
        tv_network: competitions.broadcasts?.[0]?.names?.[0] ?? null,
      };

      const { error } = await db
        .from("games")
        .upsert(row, { onConflict: "id" });
      if (error) {
        await logStep(db, "games", "error", `Game ${game.id}: ${error.message}`);
      }
    } catch (err) {
      await logStep(db, "games", "error", `Game ${game.id}: ${err}`);
    }
  }
}

// --- Step 3 & 4: Compute team stats ---

async function computeTeamStats(db: DbClient, season: number) {
  const year = season;

  const { data: games } = await db
    .from("games")
    .select(
      "home_team_id, away_team_id, home_score, away_score, start_time, status"
    )
    .eq("season", year)
    .eq("status", "final");

  if (!games) return;

  const stats = new Map<
    number,
    {
      wins: number;
      losses: number;
      ties: number;
      points_scored: number;
      points_allowed: number;
      home_wins: number;
      home_losses: number;
      home_ties: number;
      away_wins: number;
      away_losses: number;
      away_ties: number;
      results: ("W" | "L" | "T")[];
      scoredDates: { points: number; allowed: number; date: string }[];
    }
  >();

  const init = () => ({
    wins: 0,
    losses: 0,
    ties: 0,
    points_scored: 0,
    points_allowed: 0,
    home_wins: 0,
    home_losses: 0,
    home_ties: 0,
    away_wins: 0,
    away_losses: 0,
    away_ties: 0,
    results: [] as ("W" | "L" | "T")[],
    scoredDates: [] as { points: number; allowed: number; date: string }[],
  });

  for (const game of games) {
    const homeId = game.home_team_id;
    const awayId = game.away_team_id;
    if (
      !homeId ||
      !awayId ||
      game.home_score == null ||
      game.away_score == null
    )
      continue;

    if (!stats.has(homeId)) stats.set(homeId, init());
    if (!stats.has(awayId)) stats.set(awayId, init());

    const hs = stats.get(homeId)!;
    const as = stats.get(awayId)!;
    const hsScore = game.home_score;
    const asScore = game.away_score;

    hs.points_scored += hsScore;
    hs.points_allowed += asScore;
    as.points_scored += asScore;
    as.points_allowed += hsScore;

    const date = game.start_time ?? new Date().toISOString();

    if (hsScore > asScore) {
      hs.wins++;
      hs.home_wins++;
      hs.results.push("W");
      as.losses++;
      as.away_losses++;
      as.results.push("L");
    } else if (hsScore < asScore) {
      hs.losses++;
      hs.home_losses++;
      hs.results.push("L");
      as.wins++;
      as.away_wins++;
      as.results.push("W");
    } else {
      hs.ties++;
      hs.home_ties++;
      hs.results.push("T");
      as.ties++;
      as.away_ties++;
      as.results.push("T");
    }

    hs.scoredDates.push({ points: hsScore, allowed: asScore, date });
    as.scoredDates.push({ points: asScore, allowed: hsScore, date });
  }

  for (const [teamId, s] of stats) {
    const gamesPlayed = s.wins + s.losses + s.ties;

    let streakType: "W" | "L" | "T" | null = null;
    let streakCount = 0;
    for (let i = s.results.length - 1; i >= 0; i--) {
      const r = s.results[i];
      if (streakType === null) {
        streakType = r;
        streakCount = 1;
      } else if (r === streakType) {
        streakCount++;
      } else {
        break;
      }
    }

    const sorted = [...s.scoredDates].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const last3 = sorted.slice(0, 3);
    const last3AvgPts =
      last3.length > 0
        ? last3.reduce((sum, g) => sum + g.points, 0) / last3.length
        : 0;
    const last3AvgAllowed =
      last3.length > 0
        ? last3.reduce((sum, g) => sum + g.allowed, 0) / last3.length
        : 0;

    await db.from("team_stats").upsert(
      {
        team_id: teamId,
        season: year,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        points_scored: s.points_scored,
        points_allowed: s.points_allowed,
        games_played: gamesPlayed,
        home_wins: s.home_wins,
        home_losses: s.home_losses,
        home_ties: s.home_ties,
        away_wins: s.away_wins,
        away_losses: s.away_losses,
        away_ties: s.away_ties,
        streak_type: streakType,
        streak_count: streakCount,
        last_3_avg_points: Math.round(last3AvgPts * 10) / 10,
        last_3_avg_allowed: Math.round(last3AvgAllowed * 10) / 10,
      },
      { onConflict: "team_id,season" }
    );
  }

  // Pass 2: Strength of schedule
  const { data: allStats } = await db
    .from("team_stats")
    .select("team_id, wins, losses, ties, games_played")
    .eq("season", year);

  if (!allStats) return;

  const winPctMap = new Map<number, number>();
  for (const ts of allStats) {
    if (ts.games_played > 0) {
      winPctMap.set(ts.team_id, (ts.wins + ts.ties * 0.5) / ts.games_played);
    } else {
      winPctMap.set(ts.team_id, 0.5);
    }
  }

  for (const [teamId] of stats) {
    const opponents: number[] = [];
    for (const game of games) {
      if (game.home_team_id === teamId && game.away_team_id) {
        opponents.push(game.away_team_id);
      } else if (game.away_team_id === teamId && game.home_team_id) {
        opponents.push(game.home_team_id);
      }
    }

    if (opponents.length === 0) continue;

    const sos =
      opponents.reduce((sum, opp) => sum + (winPctMap.get(opp) ?? 0.5), 0) /
      opponents.length;

    await db
      .from("team_stats")
      .update({ strength_of_schedule: Math.round(sos * 1000) / 1000 })
      .eq("team_id", teamId)
      .eq("season", year);
  }

  await logStep(db, "stats", "success", `Computed stats for ${stats.size} teams`);
}

// --- Step 5: Generate predictions ---

async function generatePredictions(db: DbClient, season: number) {
  const year = season;

  // Find games that don't have predictions yet (scheduled or already final)
  const { data: allGames } = await db
    .from("games")
    .select("id, home_team_id, away_team_id")
    .eq("season", year);

  if (!allGames || allGames.length === 0) return;

  // Get game IDs that already have predictions
  const { data: existingPreds } = await db
    .from("predictions")
    .select("game_id");

  const existingIds = new Set((existingPreds ?? []).map((p) => p.game_id));
  const gamesToPredict = allGames.filter((g) => !existingIds.has(g.id));

  if (gamesToPredict.length === 0) return;

  const { data: allStats } = await db
    .from("team_stats")
    .select("*")
    .eq("season", year);

  const statsMap = new Map<number, NonNullable<typeof allStats>[number]>();
  if (allStats) {
    for (const s of allStats) statsMap.set(s.team_id, s);
  }

  const prevYear = year - 1;
  const { data: prevStats } = await db
    .from("team_stats")
    .select("*")
    .eq("season", prevYear);

  const prevStatsMap = new Map<number, NonNullable<typeof prevStats>[number]>();
  if (prevStats) {
    for (const s of prevStats) prevStatsMap.set(s.team_id, s);
  }

  let predicted = 0;

  for (const game of gamesToPredict) {
    const homeStats = statsMap.get(game.home_team_id);
    const awayStats = statsMap.get(game.away_team_id);
    if (!homeStats || !awayStats) continue;

    const homeInput: TeamStatsInput & { team_id: number } = {
      team_id: homeStats.team_id,
      ...homeStats,
    };
    const awayInput: TeamStatsInput & { team_id: number } = {
      team_id: awayStats.team_id,
      ...awayStats,
    };

    const prevHome = prevStatsMap.get(game.home_team_id) ?? null;
    const prevAway = prevStatsMap.get(game.away_team_id) ?? null;
    const blendedHome = blendStats(
      homeInput,
      prevHome as TeamStatsInput | null,
      homeStats.games_played
    );
    const blendedAway = blendStats(
      awayInput,
      prevAway as TeamStatsInput | null,
      awayStats.games_played
    );

    const h2hPct = await getH2HWinPct(
      db,
      game.home_team_id,
      game.away_team_id,
      5
    );

    const prediction = predictGame(
      { ...blendedHome, team_id: game.home_team_id },
      { ...blendedAway, team_id: game.away_team_id },
      h2hPct
    );

    await db.from("predictions").upsert(
      {
        game_id: game.id,
        predicted_winner_id: prediction.predicted_winner_id,
        confidence: prediction.confidence,
        home_win_prob: prediction.home_win_prob,
        away_win_prob: prediction.away_win_prob,
        reasoning: prediction.reasoning,
      },
      { onConflict: "game_id" }
    );

    predicted++;
  }

  await logStep(db, "predictions", "success", `Generated ${predicted} predictions`);
}

async function getH2HWinPct(
  db: DbClient,
  teamA: number,
  teamB: number,
  limit: number
): Promise<number> {
  const { data: matchups } = await db
    .from("games")
    .select("home_team_id, away_team_id, home_score, away_score")
    .eq("status", "final")
    .or(`home_team_id.eq.${teamA},away_team_id.eq.${teamA}`)
    .order("start_time", { ascending: false })
    .limit(limit * 2);

  if (!matchups || matchups.length === 0) return 0.5;

  const h2h = matchups.filter(
    (g) =>
      (g.home_team_id === teamA && g.away_team_id === teamB) ||
      (g.home_team_id === teamB && g.away_team_id === teamA)
  );

  if (h2h.length === 0) return 0.5;

  let wins = 0;
  for (const game of h2h.slice(0, limit)) {
    if (game.home_score == null || game.away_score == null) continue;
    const teamAScore =
      game.home_team_id === teamA ? game.home_score : game.away_score;
    const teamBScore =
      game.home_team_id === teamA ? game.away_score : game.home_score;
    if (teamAScore > teamBScore) wins++;
  }

  return wins / Math.min(h2h.length, limit);
}

// --- Step 6: Score old predictions ---

async function scorePredictions(db: DbClient) {
  // Get all predictions that have finalized games
  const { data: allPreds } = await db
    .from("predictions")
    .select("id, game_id, predicted_winner_id");

  if (!allPreds || allPreds.length === 0) return;

  // Get existing results to skip already-scored predictions
  const { data: existingResults } = await db
    .from("prediction_results")
    .select("prediction_id");
  const scoredIds = new Set((existingResults ?? []).map((r) => r.prediction_id));

  // Get finalized games for these predictions
  const gameIds = allPreds.map((p) => p.game_id);
  const { data: finalizedGames } = await db
    .from("games")
    .select("id, home_score, away_score, home_team_id, away_team_id, status")
    .in("id", gameIds)
    .eq("status", "final");

  if (!finalizedGames || finalizedGames.length === 0) return;

  const gameMap = new Map(finalizedGames.map((g) => [g.id, g]));

  let scored = 0;

  for (const pred of allPreds) {
    if (scoredIds.has(pred.id)) continue;

    const game = gameMap.get(pred.game_id);
    if (!game || game.home_score == null || game.away_score == null) continue;

    let actualWinnerId: number;
    if (game.home_score > game.away_score) {
      actualWinnerId = game.home_team_id;
    } else if (game.away_score > game.home_score) {
      actualWinnerId = game.away_team_id;
    } else {
      actualWinnerId = game.home_team_id;
    }

    const correct = pred.predicted_winner_id === actualWinnerId;

    await db.from("prediction_results").upsert(
      {
        prediction_id: pred.id,
        correct,
        actual_winner_id: actualWinnerId,
      },
      { onConflict: "prediction_id" }
    );

    scored++;
  }

  await logStep(db, "scoring", "success", `Scored ${scored} predictions`);
}

// --- Main sync orchestrator ---

export async function runSync(): Promise<{ status: string; message: string }> {
  const db = createServiceClient();

  // No-op check
  if (await shouldSkip(db)) {
    return {
      status: "skipped",
      message: "No-op: no active games or upcoming games",
    };
  }

  // Concurrency control
  if (!(await acquireSyncLock(db))) {
    return { status: "skipped", message: "Sync already in progress" };
  }

  try {
    // Step 1: Teams (hard dependency)
    const teamsOk = await syncTeams(db);
    if (!teamsOk) {
      await releaseSyncLock(db, "error");
      return { status: "error", message: "Teams sync failed — aborting" };
    }

    // Detect current ESPN season
    const season = await fetchCurrentSeason();

    // Step 2: Schedule
    await syncSchedule(db);

    // Steps 3-4: Team stats (two passes)
    await computeTeamStats(db, season);

    // Step 5: Predictions
    await generatePredictions(db, season);

    // Step 6: Score old predictions
    await scorePredictions(db);

    await releaseSyncLock(db, "success");
    return { status: "success", message: `Sync completed for season ${season}` };
  } catch (err) {
    await releaseSyncLock(db, "error");
    return { status: "error", message: String(err) };
  }
}
