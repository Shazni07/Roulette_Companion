import type { Round } from "./types";

/**
 * Chip history of ONE betting position, derived only from saved (completed)
 * rounds of the session. Nothing here is stored separately, so it can never
 * drift away from the saved rounds. It is information only: it is never added
 * to the chips a player holds or to the current round's totals.
 */
export interface ChipCount {
  chips: number;
  /** quantity by chip value (minor units) */
  byValue: Record<number, number>;
}

export interface PositionHistory {
  /** Round number of the immediately preceding completed round (null in round 1). */
  previousRoundNumber: number | null;
  /** Chips on this position in THAT round only (zero if it was not used). */
  previous: ChipCount;
  /** Round numbers of every completed round before the current one. */
  earlierRoundNumbers: number[];
  /** Chips on this position summed over all those earlier rounds. */
  cumulative: ChipCount;
}

const emptyCount = (): ChipCount => ({ chips: 0, byValue: {} });

function addTo(count: ChipCount, value: number, qty: number) {
  count.chips += qty;
  count.byValue[value] = (count.byValue[value] ?? 0) + qty;
}

export interface HistoryIndex {
  previousRoundNumber: number | null;
  earlierRoundNumbers: number[];
  get(positionKey: string): PositionHistory;
}

/**
 * Builds the history for every position in one pass.
 * `currentRoundNumber` is the round being prepared; only completed rounds with a
 * smaller number count. The "previous" round is the immediately preceding
 * completed round – never the most recent round that happened to use the position.
 */
export function buildHistoryIndex(rounds: Round[], currentRoundNumber: number): HistoryIndex {
  const done = rounds
    .filter((r) => r.roundStatus === "completed" && r.roundNumber < currentRoundNumber)
    .sort((a, b) => a.roundNumber - b.roundNumber);
  const previousRound = done.length ? done[done.length - 1]! : null;
  const previousRoundNumber = previousRound ? previousRound.roundNumber : null;
  const earlierRoundNumbers = done.map((r) => r.roundNumber);

  const prev = new Map<string, ChipCount>();
  const cum = new Map<string, ChipCount>();
  for (const r of done) {
    for (const b of r.bets) {
      for (const a of b.allocations) {
        if (!cum.has(b.key)) cum.set(b.key, emptyCount());
        addTo(cum.get(b.key)!, a.denominationValue, a.quantity);
        if (r === previousRound) {
          if (!prev.has(b.key)) prev.set(b.key, emptyCount());
          addTo(prev.get(b.key)!, a.denominationValue, a.quantity);
        }
      }
    }
  }
  return {
    previousRoundNumber,
    earlierRoundNumbers,
    get: (key) => ({
      previousRoundNumber,
      previous: prev.get(key) ?? emptyCount(),
      earlierRoundNumbers,
      cumulative: cum.get(key) ?? emptyCount(),
    }),
  };
}

export function positionHistory(rounds: Round[], currentRoundNumber: number, key: string): PositionHistory {
  return buildHistoryIndex(rounds, currentRoundNumber).get(key);
}

/** "Round 2", "Rounds 1 + 2", "Rounds 1 + 2 + 3" – always lists the rounds that are counted. */
export function roundsLabel(numbers: number[]): string {
  if (numbers.length === 0) return "none";
  if (numbers.length === 1) return `Round ${numbers[0]}`;
  if (numbers.length <= 4) return `Rounds ${numbers.join(" + ")}`;
  return `Rounds ${numbers[0]} to ${numbers[numbers.length - 1]}`;
}

/** Preview only: cumulative previous chips plus the chips entered for the current round. */
export function projectedCumulative(history: PositionHistory, currentChips: number): number {
  return history.cumulative.chips + currentChips;
}
