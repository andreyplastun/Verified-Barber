import { db } from "./db";
import { reviews, specialists } from "@shared/schema";
import { eq } from "drizzle-orm";

// Phase 1 gamification: specialist achievements reconstructed on-the-fly from
// review history (reviews.created_at). No snapshot table / cron / migration —
// weekly standings are recomputed from scratch and cached in-memory.

export type AchievementBadge = {
  id: string;
  emoji: string;
  title: string;
  desc: string;
};

export type LeaderboardEntry = {
  rank: number;
  specialistId: number;
  name: string;
  reviewCount: number;
  isYou: boolean;
};

export type SpecialistAchievements = {
  rank: number | null;
  reviewCount: number;
  totalRanked: number;
  top10Streak: number;
  firstStreak: number;
  reviewsToNextRank: number | null;
  badges: AchievementBadge[];
  nudge: { title: string; message: string } | null;
  leaderboard: LeaderboardEntry[];
};

type Standings = {
  counts: Map<number, number>;
  ranks: Map<number, number>;
  reviewsToNext: Map<number, number | null>;
  top10Streak: Map<number, number>;
  firstStreak: Map<number, number>;
  names: Map<number, string>;
  leaderboard: Omit<LeaderboardEntry, "isYou">[];
  totalRanked: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Week 1 = Monday 2026-03-09 00:00 Asia/Almaty (UTC+5) => 2026-03-08T19:00:00Z.
const START_MS = Date.UTC(2026, 2, 8, 19, 0, 0);
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { at: number; data: Standings } | null = null;

function reviewWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "отзывов";
  if (b > 1 && b < 5) return "отзыва";
  if (b === 1) return "отзыв";
  return "отзывов";
}

function streakOf(weekly: Set<number>[], sid: number): number {
  let s = 0;
  for (let k = weekly.length - 1; k >= 0; k--) {
    if (weekly[k].has(sid)) s++;
    else break;
  }
  return s;
}

async function computeStandings(): Promise<Standings> {
  const rows = await db
    .select({ specialistId: reviews.specialistId, createdAt: reviews.createdAt })
    .from(reviews)
    .where(eq(reviews.isFinalized, true));

  const events: { ts: number; sid: number }[] = [];
  for (const r of rows) {
    if (!r.createdAt) continue;
    events.push({ ts: new Date(r.createdAt).getTime(), sid: r.specialistId });
  }

  const now = Date.now();
  const nweeks = Math.max(0, Math.floor((now - START_MS) / WEEK_MS) + 1);

  // Weekly cumulative standings -> per-week top10 / #1 membership.
  const weeklyTop10: Set<number>[] = [];
  const weeklyFirst: Set<number>[] = [];
  for (let k = 0; k < nweeks; k++) {
    const weekEnd = START_MS + (k + 1) * WEEK_MS;
    const cum = new Map<number, number>();
    for (const e of events) {
      if (e.ts <= weekEnd) cum.set(e.sid, (cum.get(e.sid) || 0) + 1);
    }
    const top10 = new Set<number>();
    const first = new Set<number>();
    if (cum.size > 0) {
      const sortedCounts = [...cum.values()].sort((a, b) => b - a);
      const tenth = sortedCounts[Math.min(9, sortedCounts.length - 1)];
      const max = sortedCounts[0];
      for (const [sid, c] of cum) {
        if (c > 0 && c >= tenth) top10.add(sid);
        if (c > 0 && c === max) first.add(sid);
      }
    }
    weeklyTop10.push(top10);
    weeklyFirst.push(first);
  }

  // Current cumulative counts (= all finalized reviews up to now).
  const counts = new Map<number, number>();
  for (const e of events) counts.set(e.sid, (counts.get(e.sid) || 0) + 1);

  const ordered = [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  // Competition ranking (ties share a rank: 1,2,2,4).
  const ranks = new Map<number, number>();
  let prevCount: number | null = null;
  let prevRank = 0;
  ordered.forEach(([sid, c], i) => {
    let rank: number;
    if (c === prevCount) {
      rank = prevRank;
    } else {
      rank = i + 1;
      prevRank = rank;
      prevCount = c;
    }
    ranks.set(sid, rank);
  });

  // Reviews needed to overtake the next-higher distinct count.
  const distinct = [...new Set(ordered.map(([, c]) => c))].sort((a, b) => b - a);
  const nextHigher = new Map<number, number | null>();
  distinct.forEach((c, i) => nextHigher.set(c, i === 0 ? null : distinct[i - 1]));
  const reviewsToNext = new Map<number, number | null>();
  for (const [sid, c] of ordered) {
    const higher = nextHigher.get(c);
    reviewsToNext.set(sid, higher == null ? null : higher - c + 1);
  }

  const top10Streak = new Map<number, number>();
  const firstStreak = new Map<number, number>();
  for (const [sid] of counts) {
    top10Streak.set(sid, streakOf(weeklyTop10, sid));
    firstStreak.set(sid, streakOf(weeklyFirst, sid));
  }

  const specRows = await db
    .select({ id: specialists.id, name: specialists.name })
    .from(specialists);
  const names = new Map<number, string>();
  for (const s of specRows) names.set(s.id, s.name);

  // Top-10 by competition rank. Using rank <= 10 (not slice(0,10)) keeps the
  // leaderboard consistent with the top_10 badge logic when there are ties at
  // the 10th place (all tied specialists are included).
  const leaderboard = ordered
    .filter(([sid]) => (ranks.get(sid) ?? Infinity) <= 10)
    .map(([sid, c]) => ({
      rank: ranks.get(sid)!,
      specialistId: sid,
      name: names.get(sid) || `#${sid}`,
      reviewCount: c,
    }));

  return {
    counts,
    ranks,
    reviewsToNext,
    top10Streak,
    firstStreak,
    names,
    leaderboard,
    totalRanked: ordered.length,
  };
}

async function getStandings(): Promise<Standings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const data = await computeStandings();
  cache = { at: Date.now(), data };
  return data;
}

function badgesFor(rank: number | null, top10Streak: number, firstStreak: number): AchievementBadge[] {
  const b: AchievementBadge[] = [];
  if (rank === 1) {
    b.push({ id: "rank_1", emoji: "👑", title: "Король отзывов", desc: "№1 по количеству отзывов" });
  } else if (rank === 2) {
    b.push({ id: "rank_2", emoji: "🥈", title: "Серебро", desc: "2-е место по отзывам" });
  } else if (rank === 3) {
    b.push({ id: "rank_3", emoji: "🥉", title: "Бронза", desc: "3-е место по отзывам" });
  } else if (rank != null && rank <= 10) {
    b.push({ id: "top_10", emoji: "🎖️", title: "Топ-10", desc: "В десятке лучших по отзывам" });
  }
  if (firstStreak >= 5) {
    b.push({ id: "first_5w", emoji: "👑", title: "Корона 5 недель", desc: "5 недель подряд держишь №1" });
  }
  if (top10Streak >= 10) {
    b.push({ id: "top10_10w", emoji: "🏅", title: "Топ-10 · 10 недель", desc: "10 недель подряд в десятке лучших" });
  } else if (top10Streak >= 5) {
    b.push({ id: "top10_5w", emoji: "🎖️", title: "Топ-10 · 5 недель", desc: "5 недель подряд в десятке лучших" });
  }
  return b;
}

function nudgeFor(
  rank: number | null,
  reviewsToNext: number | null,
): { title: string; message: string } | null {
  if (rank == null || rank === 1) return null;
  const need =
    reviewsToNext != null ? `Не хватает ${reviewsToNext} ${reviewWord(reviewsToNext)}.` : "";
  if (rank === 11) {
    return { title: "Ты у самой двери", message: `Ты №11 — войди в десятку! ${need}`.trim() };
  }
  if (rank === 4) {
    return { title: "Тройка ждёт тебя", message: `Ты №4 — третье место должно быть твоим. ${need}`.trim() };
  }
  if (rank === 2 || rank === 3) {
    return { title: "До вершины рукой подать", message: `Ты №${rank}. ${need} И корона твоя.`.trim() };
  }
  if (rank >= 5 && rank <= 10) {
    return { title: "Ты в десятке лучших", message: `Ты №${rank}. ${need} Двигай выше.`.trim() };
  }
  if (rank >= 12 && rank <= 20) {
    return { title: "Топ-10 совсем рядом", message: `Ты №${rank}. ${need} Войди в десятку.`.trim() };
  }
  return null;
}

export async function getSpecialistAchievements(specialistId: number): Promise<SpecialistAchievements> {
  const s = await getStandings();
  const rank = s.ranks.get(specialistId) ?? null;
  const reviewCount = s.counts.get(specialistId) ?? 0;
  const top10Streak = s.top10Streak.get(specialistId) ?? 0;
  const firstStreak = s.firstStreak.get(specialistId) ?? 0;
  const reviewsToNextRank = s.reviewsToNext.get(specialistId) ?? null;

  return {
    rank,
    reviewCount,
    totalRanked: s.totalRanked,
    top10Streak,
    firstStreak,
    reviewsToNextRank,
    badges: badgesFor(rank, top10Streak, firstStreak),
    nudge: nudgeFor(rank, reviewsToNextRank),
    leaderboard: s.leaderboard.map((e) => ({ ...e, isYou: e.specialistId === specialistId })),
  };
}
