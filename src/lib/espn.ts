import { z } from "zod";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

// --- Zod schemas for ESPN API responses ---

export const EspnTeamSchema = z.object({
  id: z.string(),
  abbreviation: z.string().default(""),
  name: z.string().default(""),
  displayName: z.string().default(""),
  location: z.string().default(""),
  color: z.string().default(""),
  logos: z
    .array(
      z.object({
        href: z.string().default(""),
      })
    )
    .default([]),
});
export type EspnTeam = z.infer<typeof EspnTeamSchema>;

const EspnCompetitorSchema = z.object({
  id: z.string(),
  homeAway: z.enum(["home", "away"]),
  score: z.string().nullable().default(null),
  team: z.object({
    id: z.string(),
  }),
});

const EspnBroadcastSchema = z.object({
  names: z.array(z.string()).default([]),
});

export const EspnGameSchema = z.object({
  id: z.string(),
  status: z.object({
    type: z.object({
      name: z.string().default(""),
    }),
  }),
  date: z.string().default(""),
  competitions: z
    .array(
      z.object({
        competitors: z.array(EspnCompetitorSchema).default([]),
        broadcasts: z.array(EspnBroadcastSchema).default([]),
        venue: z
          .object({
            fullName: z.string().default(""),
          })
          .nullable()
          .default(null),
      })
    )
    .default([]),
  week: z
    .union([z.number(), z.object({ number: z.number().default(0) })])
    .nullable()
    .default(null),
  seasonType: z.number().nullable().default(null),
});
export type EspnGame = z.infer<typeof EspnGameSchema>;

export const EspnScoreboardSchema = z.object({
  events: z.array(EspnGameSchema).default([]),
  week: z
    .union([z.number(), z.object({ number: z.number().default(0) })])
    .nullable()
    .default(null),
  season: z
    .object({
      year: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
});

// --- Fetch helpers ---

export async function fetchEspnTeams(): Promise<EspnTeam[]> {
  const res = await fetch(`${ESPN_BASE}/teams`);
  if (!res.ok) throw new Error(`ESPN teams fetch failed: ${res.status}`);
  const data = await res.json();
  const teams: unknown[] = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams
    .map((t: unknown) => {
      const parsed = EspnTeamSchema.safeParse((t as { team?: unknown })?.team);
      return parsed.success ? parsed.data : null;
    })
    .filter((t): t is EspnTeam => t !== null);
}

export async function fetchEspnScoreboard(
  week: number,
  seasonType: number = 2
): Promise<{ events: EspnGame[]; seasonYear: number | null }> {
  const url = `${ESPN_BASE}/scoreboard?week=${week}&seasontype=${seasonType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed: ${res.status}`);
  const data = await res.json();
  const parsed = EspnScoreboardSchema.safeParse(data);
  if (!parsed.success) return { events: [], seasonYear: null };
  return {
    events: parsed.data.events,
    seasonYear: parsed.data.season?.year ?? null,
  };
}

/** Fetch the current ESPN NFL season year from the default scoreboard */
export async function fetchCurrentSeason(): Promise<number> {
  const res = await fetch(`${ESPN_BASE}/scoreboard`);
  if (!res.ok) return new Date().getFullYear();
  const data = await res.json();
  const parsed = EspnScoreboardSchema.safeParse(data);
  return parsed.success ? (parsed.data.season?.year ?? new Date().getFullYear()) : new Date().getFullYear();
}

/** Extract numeric week value from ESPN's week field (number or {number: N}) */
export function extractWeek(week: number | { number: number } | null | undefined): number {
  if (week == null) return 0;
  if (typeof week === "number") return week;
  return week.number;
}

/** Map ESPN status type name to our internal status */
export function mapEspnStatus(statusName: string): string {
  const lower = statusName.toLowerCase();
  if (lower === "status_scheduled") return "scheduled";
  if (lower === "status_in_progress") return "in_progress";
  if (lower === "status_final") return "final";
  if (lower === "status_postponed") return "postponed";
  if (lower === "status_cancelled") return "cancelled";
  return "scheduled";
}
