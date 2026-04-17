export interface TeamStatsInput {
  wins: number;
  losses: number;
  ties: number;
  points_scored: number;
  points_allowed: number;
  games_played: number;
  home_wins: number;
  home_losses: number;
  home_ties: number;
  away_wins: number;
  away_losses: number;
  away_ties: number;
  strength_of_schedule: number;
  last_3_avg_points: number;
  last_3_avg_allowed: number;
}

export interface PredictionResult {
  predicted_winner_id: number;
  confidence: number;
  home_win_prob: number;
  away_win_prob: number;
  reasoning: Record<string, { home: number; away: number }>;
}

interface NormalizedFactors {
  win_pct: { home: number; away: number };
  point_diff: { home: number; away: number };
  recent_form: { home: number; away: number };
  home_field: { home: number; away: number };
  sos: { home: number; away: number };
  h2h: { home: number; away: number };
}

const WEIGHTS = {
  win_pct: 0.15,
  point_diff: 0.2,
  recent_form: 0.2,
  home_field: 0.15,
  sos: 0.15,
  h2h: 0.15,
};

const SCALING_FACTOR = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTo01(value: number, divisor: number): number {
  const clamped = clamp(value / divisor, -1, 1);
  return (clamped + 1) / 2;
}

function winPct(stats: TeamStatsInput): number {
  if (stats.games_played === 0) return 0.5;
  return (stats.wins + stats.ties * 0.5) / stats.games_played;
}

function pointDiffPerGame(stats: TeamStatsInput): number {
  if (stats.games_played === 0) return 0;
  return (stats.points_scored - stats.points_allowed) / stats.games_played;
}

function recentFormDiff(stats: TeamStatsInput): number {
  return stats.last_3_avg_points - stats.last_3_avg_allowed;
}

function computeFactors(
  home: TeamStatsInput,
  away: TeamStatsInput,
  h2hHomeWinPct: number
): NormalizedFactors {
  return {
    win_pct: {
      home: winPct(home),
      away: winPct(away),
    },
    point_diff: {
      home: normalizeTo01(pointDiffPerGame(home), 20),
      away: normalizeTo01(pointDiffPerGame(away), 20),
    },
    recent_form: {
      home: normalizeTo01(recentFormDiff(home), 14),
      away: normalizeTo01(recentFormDiff(away), 14),
    },
    home_field: {
      home: 0.55,
      away: 0.45,
    },
    sos: {
      home: home.strength_of_schedule ?? 0.5,
      away: away.strength_of_schedule ?? 0.5,
    },
    h2h: {
      home: h2hHomeWinPct,
      away: 1 - h2hHomeWinPct,
    },
  };
}

function weightedComposite(factors: NormalizedFactors, side: "home" | "away"): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    score += factors[key as keyof NormalizedFactors][side] * weight;
  }
  return score;
}

export function predictGame(
  home: TeamStatsInput & { team_id: number },
  away: TeamStatsInput & { team_id: number },
  h2hHomeWinPct: number = 0.5
): PredictionResult {
  const factors = computeFactors(home, away, h2hHomeWinPct);
  const homeComposite = weightedComposite(factors, "home");
  const awayComposite = weightedComposite(factors, "away");

  const diff = (homeComposite - awayComposite) * SCALING_FACTOR;
  const homeWinProb = 1 / (1 + Math.exp(-diff));
  const awayWinProb = 1 - homeWinProb;

  const predicted_winner_id =
    homeWinProb >= awayWinProb ? home.team_id : away.team_id;

  const confidence = Math.abs(homeWinProb - awayWinProb);

  const reasoning: Record<string, { home: number; away: number }> = {};
  for (const key of Object.keys(WEIGHTS)) {
    reasoning[key] = factors[key as keyof NormalizedFactors];
  }

  return {
    predicted_winner_id,
    confidence,
    home_win_prob: homeWinProb,
    away_win_prob: awayWinProb,
    reasoning,
  };
}

/** Confidence badge label derived from raw confidence value */
export function confidenceLabel(confidence: number): "HIGH" | "MED" | "LOW" {
  if (confidence > 0.3) return "HIGH";
  if (confidence >= 0.15) return "MED";
  return "LOW";
}

/**
 * Blend current season stats with previous season stats for early season.
 * games_played < 4 => blend. >= 4 => use current as-is.
 */
export function blendStats(
  current: TeamStatsInput,
  previous: TeamStatsInput | null,
  gamesPlayed: number
): TeamStatsInput {
  if (gamesPlayed >= 4 || !previous) return current;

  const weight = gamesPlayed / 4;
  const blend = (curr: number, prev: number) =>
    curr * weight + prev * (1 - weight);

  return {
    wins: Math.round(blend(current.wins, previous.wins)),
    losses: Math.round(blend(current.losses, previous.losses)),
    ties: Math.round(blend(current.ties, previous.ties)),
    points_scored: Math.round(blend(current.points_scored, previous.points_scored)),
    points_allowed: Math.round(blend(current.points_allowed, previous.points_allowed)),
    games_played: current.games_played,
    home_wins: Math.round(blend(current.home_wins, previous.home_wins)),
    home_losses: Math.round(blend(current.home_losses, previous.home_losses)),
    home_ties: Math.round(blend(current.home_ties, previous.home_ties)),
    away_wins: Math.round(blend(current.away_wins, previous.away_wins)),
    away_losses: Math.round(blend(current.away_losses, previous.away_losses)),
    away_ties: Math.round(blend(current.away_ties, previous.away_ties)),
    strength_of_schedule: blend(
      current.strength_of_schedule ?? 0.5,
      previous.strength_of_schedule ?? 0.5
    ),
    last_3_avg_points: blend(current.last_3_avg_points, previous.last_3_avg_points),
    last_3_avg_allowed: blend(current.last_3_avg_allowed, previous.last_3_avg_allowed),
  };
}
