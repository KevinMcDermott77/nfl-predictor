import TeamBadge from "./TeamBadge";
import ProbabilityBar from "./ProbabilityBar";
import ConfidenceBadge from "./ConfidenceBadge";

interface TeamInfo {
  id: number;
  name: string;
  abbreviation: string;
  logo_url: string | null;
  color: string | null;
}

interface PredictionInfo {
  predicted_winner_id: number;
  confidence: number;
  home_win_prob: number;
  away_win_prob: number;
}

interface PredictionResult {
  correct: boolean;
}

interface PredictionCardProps {
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  startTime: string | null;
  tvNetwork: string | null;
  venue: string | null;
  prediction: PredictionInfo | null;
  result: PredictionResult | null;
  homeScore: number | null;
  awayScore: number | null;
}

export default function PredictionCard({
  homeTeam,
  awayTeam,
  startTime,
  tvNetwork,
  venue,
  prediction,
  result,
  homeScore,
  awayScore,
}: PredictionCardProps) {
  const isHomeWinner = prediction?.predicted_winner_id === homeTeam.id;
  const gameDate = startTime
    ? new Date(startTime).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  const gameTime = startTime
    ? new Date(startTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="bg-[var(--bg-card)] border border-white/5 rounded-xl p-5 hover:border-white/10 transition-colors">
      {/* Teams */}
      <div className="flex items-center justify-between mb-4">
        <div
          className={
            isHomeWinner && prediction ? "opacity-100" : prediction ? "opacity-50" : ""
          }
        >
          <TeamBadge
            name={homeTeam.name}
            abbreviation={homeTeam.abbreviation}
            logoUrl={homeTeam.logo_url}
            color={homeTeam.color}
          />
        </div>

        <div className="text-[var(--text-secondary)] text-xs font-medium px-2">
          VS
        </div>

        <div
          className={
            !isHomeWinner && prediction ? "opacity-100" : prediction ? "opacity-50" : ""
          }
        >
          <TeamBadge
            name={awayTeam.name}
            abbreviation={awayTeam.abbreviation}
            logoUrl={awayTeam.logo_url}
            color={awayTeam.color}
          />
        </div>
      </div>

      {/* Scores (if final) */}
      {homeScore != null && awayScore != null && (
        <div className="flex justify-center gap-8 mb-3 text-2xl font-bold text-[var(--text-primary)]">
          <span>{homeScore}</span>
          <span className="text-[var(--text-secondary)]">-</span>
          <span>{awayScore}</span>
        </div>
      )}

      {/* Prediction */}
      {prediction && (
        <div className="mb-3">
          <ProbabilityBar
            homeWinProb={prediction.home_win_prob}
            awayWinProb={prediction.away_win_prob}
            homeAbbr={homeTeam.abbreviation}
            awayAbbr={awayTeam.abbreviation}
          />
          <div className="flex items-center justify-between mt-2">
            <ConfidenceBadge confidence={prediction.confidence} />
            {result && (
              <span
                className={
                  result.correct
                    ? "text-[var(--accent-green)] font-bold"
                    : "text-[var(--accent-red)] font-bold"
                }
              >
                {result.correct ? "✓ Correct" : "✗ Wrong"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Game info */}
      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mt-3 pt-3 border-t border-white/5">
        <span>
          {gameDate} {gameTime}
        </span>
        {tvNetwork && <span>{tvNetwork}</span>}
      </div>
    </div>
  );
}
