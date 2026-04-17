-- NFL Predictor: Initial Schema

-- Teams
CREATE TABLE teams (
  id            integer PRIMARY KEY,
  name          text NOT NULL,
  abbreviation  text NOT NULL,
  location      text,
  mascot        text,
  conference    text,
  division      text,
  logo_url      text,
  color         text
);

-- Games
CREATE TABLE games (
  id            bigint PRIMARY KEY,
  season        integer NOT NULL,
  week          integer NOT NULL,
  season_type   integer NOT NULL DEFAULT 2,
  status        text NOT NULL DEFAULT 'scheduled',
  home_team_id  integer NOT NULL REFERENCES teams(id),
  away_team_id  integer NOT NULL REFERENCES teams(id),
  home_score    integer,
  away_score    integer,
  start_time    timestamptz,
  venue         text,
  tv_network    text
);

-- Team Stats
CREATE TABLE team_stats (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              integer NOT NULL REFERENCES teams(id),
  season               integer NOT NULL,
  wins                 integer NOT NULL DEFAULT 0,
  losses               integer NOT NULL DEFAULT 0,
  ties                 integer NOT NULL DEFAULT 0,
  points_scored        integer NOT NULL DEFAULT 0,
  points_allowed       integer NOT NULL DEFAULT 0,
  games_played         integer NOT NULL DEFAULT 0,
  home_wins            integer NOT NULL DEFAULT 0,
  home_losses          integer NOT NULL DEFAULT 0,
  home_ties            integer NOT NULL DEFAULT 0,
  away_wins            integer NOT NULL DEFAULT 0,
  away_losses          integer NOT NULL DEFAULT 0,
  away_ties            integer NOT NULL DEFAULT 0,
  streak_type          text,
  streak_count         integer NOT NULL DEFAULT 0,
  strength_of_schedule float,
  last_3_avg_points    float NOT NULL DEFAULT 0,
  last_3_avg_allowed   float NOT NULL DEFAULT 0,
  UNIQUE (team_id, season)
);

-- Predictions
CREATE TABLE predictions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             bigint NOT NULL REFERENCES games(id) UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  predicted_winner_id integer NOT NULL REFERENCES teams(id),
  confidence          float NOT NULL,
  home_win_prob       float NOT NULL,
  away_win_prob       float NOT NULL,
  reasoning           jsonb
);

-- Prediction Results
CREATE TABLE prediction_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id     uuid NOT NULL REFERENCES predictions(id) UNIQUE,
  correct           boolean NOT NULL,
  actual_winner_id  integer NOT NULL REFERENCES teams(id),
  scored_at         timestamptz NOT NULL DEFAULT now()
);

-- Sync Log
CREATE TABLE sync_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step      text NOT NULL,
  status    text NOT NULL,
  message   text,
  run_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_games_season_status ON games (season, status);
CREATE INDEX idx_games_season_type_week ON games (season, season_type, week);
CREATE INDEX idx_games_home_team ON games (home_team_id);
CREATE INDEX idx_games_away_team ON games (away_team_id);
CREATE INDEX idx_team_stats_team_season ON team_stats (team_id, season);
CREATE INDEX idx_predictions_game ON predictions (game_id);
CREATE INDEX idx_prediction_results_prediction ON prediction_results (prediction_id);

-- Row Level Security: public read, no writes (sync uses service role key)
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Public read games" ON games FOR SELECT USING (true);
CREATE POLICY "Public read team_stats" ON team_stats FOR SELECT USING (true);
CREATE POLICY "Public read predictions" ON predictions FOR SELECT USING (true);
CREATE POLICY "Public read prediction_results" ON prediction_results FOR SELECT USING (true);
CREATE POLICY "Public read sync_log" ON sync_log FOR SELECT USING (true);
