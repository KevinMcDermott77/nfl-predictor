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

| Column          | Type           | Notes                                 |
|-----------------|----------------|---------------------------------------|
| id              | bigint PK      | ESPN game ID                          |
| season          | integer        | 2024, 2025, etc.                      |
| week            | integer        | 1–18 (reg season) + playoff weeks     |
| season_type     | integer        | 1=pre, 2=regular, 3=post              |
| status          | text           | "scheduled" / "in_progress" / "final" |
| home_team_id    | integer FK     | → teams.id                            |
| away_team_id    | integer FK     | → teams.id                            |
| home_score      | integer        | Nullable until game ends              |
| away_score      | integer        | Nullable until game ends              |
| start_time      | timestamptz    | Game start time                       |
| venue           | text           | Stadium name                          |

### `team_stats`

| Column              | Type    | Notes                                      |
|---------------------|---------|---------------------------------------------|
| id                  | uuid PK | Auto-generated                              |
| team_id             | integer FK | → teams.id                               |
| season              | integer | Season year                                 |
| wins                | integer |                                             |
| losses              | integer |                                             |
| ties                | integer |                                             |
| points_scored       | integer | Total points scored                         |
| points_allowed      | integer | Total points allowed                        |
| home_wins           | integer |                                             |
| home_losses         | integer |                                             |
| away_wins           | integer |                                             |
| away_losses         | integer |                                             |
| streak              | text    | "W3", "L2", etc.                           |
| strength_of_schedule | float  | Opponents' combined win %                   |
| last_3_avg_points   | float   | Avg points scored in last 3 games           |
| last_3_avg_allowed  | float   | Avg points allowed in last 3 games          |

Recomputed weekly after games finalize. One row per team per season.

### `predictions`

| Column              | Type       | Notes                                    |
|---------------------|------------|------------------------------------------|
| id                  | uuid PK    | Auto-generated                            |
| game_id             | bigint FK  | → games.id                                |
| created_at          | timestamptz| When prediction was generated             |
| predicted_winner_id | integer FK | → teams.id                                |
| confidence          | float      | 0.0–1.0, derived from probability delta   |
| home_win_prob       | float      |                                           |
| away_win_prob       | float      |                                           |
| reasoning           | jsonb      | Factor breakdown for transparency         |

### `prediction_results`

| Column             | Type       | Notes                      |
|--------------------|------------|----------------------------|
| id                 | uuid PK    | Auto-generated              |
| prediction_id      | uuid FK    | → predictions.id            |
| correct            | boolean    | Was the prediction right?   |
| actual_winner_id   | integer FK | → teams.id                  |
| scored_at          | timestamptz| When result was scored      |

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

1. **Fetch teams** — `GET .../nfl/teams` → upsert into `teams`
2. **Fetch schedule** — `GET .../nfl/scoreboard?week=N&season=YYYY&seasontype=X` → upsert `games`
3. **Finalize past games** — For games now `status=final`, update scores. Trigger stat recomputation.
4. **Compute team_stats** — Aggregate from finalized games: wins/losses, points, home/away splits, streaks, strength of schedule
5. **Generate predictions** — For `status=scheduled` games, run prediction algorithm and write `predictions`
6. **Score old predictions** — For newly finalized games, compare prediction vs result → write `prediction_results`

Each step logs to `sync_log`. Individual step failures don't abort the entire sync.

### Cron Schedule (Railway cron)

- **Daily at 6 AM ET:** Full sync (teams + all weeks' games + stats + predictions)
- **Game days (Sun/Mon):** Every 30 min during game windows (12 PM–12 AM ET) to pick up score changes
- **Off-season:** Once daily, minimal work (ESPN still serves schedule data)

The sync endpoint is protected by a `SYNC_SECRET` bearer token to prevent unauthorized runs.

## Prediction Algorithm

Advanced stats model using six weighted factors. No machine learning in v1 — weighted heuristic.

### Inputs (from `team_stats`)

| Factor                    | Weight | Source                           |
|---------------------------|--------|----------------------------------|
| Win percentage            | 15%    | wins / (wins + losses + ties)    |
| Point differential        | 20%    | (points_scored - points_allowed) / games |
| Recent form               | 20%    | (last_3_avg_points - last_3_avg_allowed) |
| Home field advantage      | 15%    | Fixed bonus for home team        |
| Strength of schedule      | 15%    | Opponents' combined win %        |
| Head-to-head              | 15%    | Recent matchup history           |

### Algorithm

1. Pull both teams' stats from `team_stats`
2. Compute composite score for each team using weighted factors
3. Normalize to probability (0.0–1.0) using logistic function: `p = 1 / (1 + e^(-diff))`
4. Winner = team with higher probability
5. Confidence = probability delta between teams
   - HIGH: delta > 0.3
   - MED: delta 0.15–0.3
   - LOW: delta < 0.15
6. Store `reasoning` as JSONB with each factor's contribution

### Pre-season / Early Season

First 4 weeks of a new season use previous season's final stats with a decay factor, blending in current year data as it accumulates. If no previous season data exists, predictions default to lower confidence.

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

- **Week selector** — dropdown or tabs, auto-detects current week
- **Game card grid** — each card shows:
  - Away team logo + name @ Home team logo + name
  - Predicted winner highlighted with accent glow
  - Win probability bar (e.g., "KC 62% — vs — LV 38%")
  - Confidence badge (HIGH / MED / LOW)
  - Game time + TV network
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
│   │   ├── espn.ts                 # ESPN API fetch helpers
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
- Railway cron hits `/api/sync` on configured schedule
- Supabase free tier for database
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SYNC_SECRET`

## Future Iterations (Post-MVP)

- User accounts with Supabase Auth (email + OAuth)
- User-submitted picks competing against the algorithm
- Point spread predictions
- Player stat predictions (fantasy integration)
- Pick'em pools / leaderboards
- ML model upgrade for predictions
- Real-time score updates via Supabase realtime
