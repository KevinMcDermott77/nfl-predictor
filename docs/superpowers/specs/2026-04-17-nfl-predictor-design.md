# NFL Predictor — Design Spec

## Overview

NFL Predictor is a public-read-only web dashboard that displays algorithm-generated NFL game winner predictions using an advanced stats model. No user accounts or authentication in v1.

**Tech stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Supabase (Postgres), Railway deployment.

**Data source:** ESPN public API (`https://site.api.espn.com/apis/site/v2/sports/football/nfl`) — free, no API key required.

## Architecture: Full Database Mirror

All ESPN data is synced into Supabase. The Next.js app reads exclusively from Supabase, never hitting ESPN at request time. A cron-triggered API route handles all syncing.

- **Cron job** pulls teams, games, standings, and stats from ESPN into Supabase tables
- **All page reads** go to Supabase — fast, consistent, no external API dependency at request time
- **Prediction algorithm** reads from Supabase tables
- Full data ownership enables flexible queries and historical analysis

## Database Schema

### `teams`

| Column        | Type         | Notes                        |
|---------------|--------------|------------------------------|
| id            | integer PK   | ESPN team ID                 |
| name          | text         | Full name (e.g., "Kansas City Chiefs") |
| abbreviation  | text         | "KC"                         |
| location      | text         | "Kansas City"                |
| mascot        | text         | "Chiefs"                     |
| conference    | text         | "AFC" / "NFC"                |
| division      | text         | "AFC West" etc.              |
| logo_url      | text         | ESPN logo URL                |
| color         | text         | Primary team hex color       |

Synced weekly. Rarely changes mid-season.

### `games`

| Column          | Type           | Notes                                              |
|-----------------|----------------|----------------------------------------------------|
| id              | bigint PK      | ESPN game ID                                       |
| season          | integer        | 2024, 2025, etc.                                   |
| week            | integer        | Week number within the season_type                 |
| season_type     | integer        | 1=preseason, 2=regular (weeks 1-18), 3=postseason   |
| status          | text           | "scheduled" / "in_progress" / "final" / "postponed" / "cancelled" |
| home_team_id    | integer FK     | → teams.id                                         |
| away_team_id    | integer FK     | → teams.id                                         |
| home_score      | integer        | Nullable until game ends                           |
| away_score      | integer        | Nullable until game ends                           |
| start_time      | timestamptz    | Game start time                                    |
| venue           | text           | Stadium name                                       |
| tv_network      | text           | Broadcasting network (nullable)                    |

**Playoff week mapping:** ESPN uses `season_type=3` with weeks: 1=Wild Card, 2=Divisional, 3=Conference, 4=Super Bowl. The frontend maps these to display labels. Regular season is `season_type=2`, weeks 1-18.

**Display ordering:** Games are ordered by `season_type, week, start_time`. The frontend groups by week and labels postseason weeks with their names rather than numbers.

### `team_stats`

| Column              | Type    | Notes                                      |
|---------------------|---------|---------------------------------------------|
| id                  | uuid PK | Auto-generated                              |
| team_id             | integer FK | → teams.id (UNIQUE with season)          |
| season              | integer | Season year (UNIQUE with team_id)           |
| wins                | integer |                                             |
| losses              | integer |                                             |
| ties                | integer |                                             |
| points_scored       | integer | Total points scored                         |
| points_allowed      | integer | Total points allowed                        |
| games_played        | integer | Total games played (wins + losses + ties)   |
| home_wins           | integer |                                             |
| home_losses         | integer |                                             |
| home_ties           | integer |                                             |
| away_wins           | integer |                                             |
| away_losses         | integer |                                             |
| away_ties           | integer |                                             |
| streak_type         | text    | "W" or "L" or "T"                          |
| streak_count        | integer | Length of current streak                     |
| strength_of_schedule | float  | Opponents' combined win %                   |
| last_3_avg_points   | float   | Avg points scored in last 3 games           |
| last_3_avg_allowed  | float   | Avg points allowed in last 3 games          |

**Unique constraint:** `(team_id, season)` — one stats row per team per season. Upsert on sync.

**Streak definition:** Consecutive games of the same result type. A tie breaks both win and loss streaks. Stored as `streak_type` + `streak_count` (e.g., W3 = won 3 in a row). Ties are tracked as "T1" (a tie is never consecutive in practice).

Recomputed weekly after games finalize.

**Last-3 computation:** `last_3_avg_points` and `last_3_avg_allowed` are the average points scored/allowed in the team's 3 most recent finalized games, ordered by `start_time`. If fewer than 3 games have been played, use all available games (minimum 1). For a team with 0 games, these default to 0.

### Indexes

Suggested indexes for common query patterns:
- `games`: `(season, status)`, `(season, season_type, week)`, `(home_team_id)`, `(away_team_id)`
- `team_stats`: `(team_id, season)` — also the unique constraint
- `predictions`: `(game_id)` — also the unique constraint
- `prediction_results`: `(prediction_id)` — also the unique constraint

### `predictions`

| Column              | Type       | Notes                                    |
|---------------------|------------|------------------------------------------|
| id                  | uuid PK    | Auto-generated                            |
| game_id             | bigint FK  | → games.id (UNIQUE)                       |
| created_at          | timestamptz| When prediction was generated             |
| predicted_winner_id | integer FK | → teams.id                                |
| confidence          | float      | 0.0–1.0, raw probability delta            |
| home_win_prob       | float      |                                           |
| away_win_prob       | float      |                                           |
| reasoning           | jsonb      | Factor breakdown for transparency         |

**Unique constraint:** `game_id` — one prediction per game. Upsert on sync. The `confidence` float is stored as-is; the HIGH/MED/LOW badge label is derived in the frontend.

### `prediction_results`

| Column             | Type       | Notes                      |
|--------------------|------------|----------------------------|
| id                 | uuid PK    | Auto-generated              |
| prediction_id      | uuid FK    | → predictions.id (UNIQUE)   |
| correct            | boolean    | Was the prediction right?   |
| actual_winner_id   | integer FK | → teams.id                  |
| scored_at          | timestamptz| When result was scored      |

**Unique constraint:** `prediction_id` — one result per prediction.

### `sync_log`

| Column     | Type       | Notes                            |
|------------|------------|----------------------------------|
| id         | uuid PK    | Auto-generated                    |
| step       | text       | "teams", "games", "stats", etc.   |
| status     | text       | "success" / "error"               |
| message    | text       | Details or error message          |
| run_at     | timestamptz| Timestamp                         |

**Row Level Security:** All tables public-read (no auth in v1). Sync endpoint protected by bearer token.

## ESPN Sync Engine

### Sync Flow

The `/api/sync` route orchestrates these steps in order:

**Concurrency control:** On start, write a `sync_log` entry with `step='sync_run', status='running'`. If a `status='running'` entry already exists (created in the last 30 minutes), return early to prevent concurrent syncs. On completion, update this entry to `status='success'` or `status='error'`.

1. **Fetch teams** — `GET .../nfl/teams` → upsert into `teams`
   - If this step fails, log error and **skip all downstream steps** (they depend on team data)
   - Retry: 3 attempts with exponential backoff (1s, 2s, 4s)
2. **Fetch schedule** — For each week in the current season, call `GET .../nfl/scoreboard?week=N&season=YYYY&seasontype=X`
   - Regular season: fetch weeks 1-18 (`seasontype=2`)
   - Postseason: fetch weeks 1-5 (`seasontype=3`), stop at the first empty response (no more playoff weeks)
   - This requires ~20 HTTP calls per full sync (18 regular + 2-5 postseason weeks)
   - Each week's response is processed independently — one failure doesn't block other weeks
   - ESPN API responses are validated with zod schemas: required fields (`id`, `status`, `competitions`) must exist. Missing fields are logged and the game is skipped.
   - `tv_network` extracted from `competitions[0].broadcasts[0].names[0]` in the ESPN response (nullable — not all games have broadcast data)
3. **Finalize past games** — For games now `status=final`, update scores. Games with `status=postponed` or `cancelled` are updated but excluded from stat computation.
4. **Compute team_stats (pass 1)** — Aggregate from finalized games: wins/losses/ties, points, home/away splits, streaks
5. **Compute team_stats (pass 2: strength of schedule)** — Requires all teams' pass-1 stats to be complete. For each team, compute opponents' combined win %. This is a separate pass because SoS depends on other teams' data.
6. **Generate predictions** — For `status=scheduled` games, run prediction algorithm and write `predictions`
7. **Score old predictions** — For newly finalized games, compare prediction vs result → write `prediction_results`

Each step logs to `sync_log`. The teams fetch (step 1) is a hard dependency — if it fails, the sync aborts. All other steps are resilient to individual failures.

**ESPN API resilience:** ESPN's public API is undocumented and may change. The sync code validates response shapes using runtime type checks (zod schemas for each endpoint). Unexpected field changes are logged to `sync_log` and the affected records are skipped rather than crashing.

### Current Week Detection

The frontend auto-detects the current week by querying:
```sql
SELECT DISTINCT season_type, week
FROM games
WHERE season = EXTRACT(YEAR FROM NOW())
  AND status = 'scheduled'
ORDER BY season_type, week
LIMIT 1;
```
This returns the next week with scheduled games.

**Off-season state:** If no scheduled games exist for the current year at all (Feb-August), the predictions page shows an off-season message: "The season hasn't started yet. Check back in September." The accuracy page continues to display last season's final accuracy data.

### Cron Schedule (Railway cron)

Railway cron cannot conditionally activate on game days. Instead:

- **Every 30 minutes, always:** Run `/api/sync`
- The sync endpoint is smart — it checks for active/in-progress games and only does heavy work when needed
- **No-op optimization:** If no games are `in_progress` and the last sync was < 4 hours ago with no `scheduled` games within 24 hours, return early without hitting ESPN
- This means ~48 sync attempts/day, but most are no-ops costing negligible resources

The sync endpoint is protected by a `SYNC_SECRET` bearer token to prevent unauthorized runs.

## Prediction Algorithm

Advanced stats model using six weighted factors. No machine learning in v1 — weighted heuristic.

### Inputs (from `team_stats`)

Each factor is normalized to a 0-1 scale before weighting:

| Factor                    | Weight | Source                                         | Normalization                                   |
|---------------------------|--------|------------------------------------------------|-------------------------------------------------|
| Win percentage            | 15%    | wins / games_played                            | Already 0-1                                      |
| Point differential        | 20%    | (points_scored - points_allowed) / games_played | Divide by 20, clamp to [-1, 1], remap: `(clamped + 1) / 2` |
| Recent form               | 20%    | last_3_avg_points - last_3_avg_allowed         | Divide by 14, clamp to [-1, 1], remap: `(clamped + 1) / 2` |
| Home field advantage      | 15%    | Fixed bonus applied to home team               | 0.55 for home team, 0.45 for away team           |
| Strength of schedule      | 15%    | opponents' combined win %                      | Already 0-1. If any opponent has 0 games played, their win % defaults to 0.5 (neutral) for SoS computation. |
| Head-to-head              | 15%    | Win % in last 5 matchups                       | Already 0-1, default 0.5 if no matchups exist. **Source:** queried at prediction time from `games` table by matching past finalized games where both teams played. |

### Algorithm

1. Pull both teams' stats from `team_stats`
2. For each factor, compute both teams' normalized scores
3. Weighted composite per team: `score = sum(factor_score * weight)` for all 6 factors
4. Compute diff: `diff = (home_composite - away_composite) * scaling_factor`
   - `scaling_factor = 10` — controls how sharply probabilities separate
   - This is the input to the logistic function
5. Home win probability: `p_home = 1 / (1 + e^(-diff))`
6. Away win probability: `p_away = 1 - p_home`
7. Winner = team with higher probability
8. Confidence: `confidence = abs(p_home - p_away)`
   - HIGH: confidence > 0.3
   - MED: confidence 0.15–0.3
   - LOW: confidence < 0.15
9. Store `reasoning` as JSONB: `{ "win_pct": { "home": 0.72, "away": 0.55 }, "point_diff": { ... }, ... }`

### Pre-season / Early Season (First 4 weeks)

When `games_played < 4`, blend current season stats with previous season's final stats:

```
blended_value = current_value * (games_played / 4) + prev_value * (1 - games_played / 4)
```

- Week 1: 100% previous season, 0% current
- Week 2: 75% previous, 25% current
- Week 3: 50/50
- Week 4: 25% previous, 75% current
- Week 5+: 100% current season

If no previous season data exists, default all normalized factor scores to 0.5 (neutral) and set confidence to LOW.

## Frontend

### Theme

Dark sportsbook style:
- Background: `#0a0a0f`
- Card surfaces: `#1a1a2e`
- Accent correct: `#00ff87` (neon green)
- Accent wrong: `#ff4444` (red)
- Primary text: `#e0e0e0`
- Secondary text: `#888`

Tailwind v4 with `@import "tailwindcss"` in globals.css. Theme colors as CSS custom properties.

### Page 1: Weekly Predictions Board (`/`)

- **Week selector** — dropdown, auto-detects current week (see "Current Week Detection" above)
- **Game card grid** — each card shows:
  - Away team logo + name @ Home team logo + name
  - Predicted winner highlighted with accent glow
  - Win probability bar (e.g., "KC 62% — vs — LV 38%")
  - Confidence badge (HIGH / MED / LOW)
  - Game time + TV network (from `games.tv_network`)
- Default view: current week
- Navigate to past weeks to see scored predictions (green check / red X on results)

### Page 2: Accuracy Tracker (`/accuracy`)

- **Season-wide stats:**
  - Overall correct % (e.g., "127/180 — 70.6%")
  - Correct by week (bar chart)
  - Confidence calibration (were HIGH confidence picks actually more accurate?)
- **Prediction table** — all past predictions with result indicator
- Filterable by week

### Components

| Component          | Purpose                                    |
|--------------------|---------------------------------------------|
| `TeamBadge`        | Team logo + name + abbreviation             |
| `PredictionCard`   | Full game prediction display                |
| `ProbabilityBar`   | Visual win probability comparison           |
| `WeekSelector`     | Navigate between NFL weeks                  |
| `AccuracyChart`    | Bar chart for weekly accuracy               |

## Error Handling

### Frontend error states

- **No data / sync never run:** Show a "season hasn't started" or "data loading" state with a clear message
- **Stale data:** Check for the most recent `sync_log` entry where `step='sync_run' AND status='success'`. If that timestamp is > 24 hours ago, show a subtle banner: "Data may be outdated — last sync: [timestamp]"
- **Missing predictions for a game:** Show the game card without a prediction section, just teams and game time

### Backend error handling

- **ESPN API down / timeout:** Sync logs the error. Existing Supabase data continues to serve stale but valid results
- **Malformed ESPN response:** Validated with zod schemas at the boundary. Invalid records are skipped and logged
- **Supabase unreachable:** Sync fails entirely, logged. Frontend continues to serve cached data if ISR revalidation hasn't expired

### Rate limiting

- The `/api/sync` endpoint is bearer-token-protected (not publicly accessible)
- Public pages serve from Supabase reads — no rate limiting needed for v1 (Supabase connection pool handles concurrency)
- If traffic spikes, add ISR revalidation (e.g., `revalidate = 300` for 5-min cache) as a tuning knob

## Testing Strategy

- **Prediction algorithm unit tests:** Test each factor normalization, composite scoring, and probability output with known inputs. This is the core product logic and must have good coverage.
- **Sync engine integration tests:** Mock ESPN responses (valid and malformed) and verify correct database writes. Test the no-op optimization.
- **Frontend component tests:** Not required for v1 (manual verification is sufficient). Add if the app grows.

## Project Structure

```
nfl-predictor/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout, dark theme, metadata
│   │   ├── page.tsx                # Weekly predictions board
│   │   ├── accuracy/page.tsx       # Accuracy tracker
│   │   ├── api/
│   │   │   └── sync/route.ts       # ESPN sync endpoint (cron target)
│   │   └── globals.css             # Tailwind v4 import + theme vars
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client
│   │   ├── espn.ts                 # ESPN API fetch helpers + zod schemas
│   │   ├── predictions.ts          # Prediction algorithm
│   │   └── sync.ts                 # Sync orchestration logic
│   └── components/
│       ├── TeamBadge.tsx
│       ├── PredictionCard.tsx
│       ├── ProbabilityBar.tsx
│       ├── WeekSelector.tsx
│       └── AccuracyChart.tsx
├── supabase/
│   └── migrations/
│       └── 001_initial.sql         # Schema + RLS policies
├── package.json
├── next.config.ts
├── tsconfig.json
└── railway.json                    # Cron config
```

## Deployment

- **Railway** connected to GitHub repo, auto-deploy on push to `main`
- Railway cron hits `/api/sync` every 30 minutes (sync is no-op aware)
- Supabase free tier for database (500MB, more than sufficient for NFL data — estimated <10MB per season)
- **Data retention:** Keep all historical seasons. NFL data is small (32 teams, ~267 games/season). No purge needed on free tier.
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SYNC_SECRET`

## Future Iterations (Post-MVP)

- User accounts with Supabase Auth (email + OAuth)
- User-submitted picks competing against the algorithm
- Point spread predictions
- Player stat predictions (fantasy integration)
- Pick'em pools / leaderboards
- ML model upgrade for predictions
- Real-time score updates via Supabase realtime
