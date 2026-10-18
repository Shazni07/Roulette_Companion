import { InventoryError, reserveChips } from "./inventory";
import { getPosition, isPositionEnabled } from "./rules";
import type { BetPosition, ChipAllocation, ChipDenomination, Position, Ruleset } from "./types";

export class BettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BettingError";
  }
}

/** One bet per unique position within a round. */
export const betIdFor = (roundId: string, key: string) => `${roundId}:${key}`;

export const stakeOf = (allocs: ChipAllocation[]) => allocs.reduce((s, a) => s + a.denominationValue * a.quantity, 0);
export const chipCountOf = (allocs: ChipAllocation[]) => allocs.reduce((s, a) => s + a.quantity, 0);

export function newBet(roundId: string, position: Position, ruleset: Ruleset): BetPosition {
  if (!isPositionEnabled(ruleset, position.key)) throw new BettingError("This table does not offer that bet.");
  return {
    id: betIdFor(roundId, position.key),
    roundId,
    key: position.key,
    betType: position.type,
    category: position.category,
    // inside bets read "Split: 7 / 8"; outside bets already have a clear name ("Red")
    label: position.category === "inside" ? `${position.typeLabel}: ${position.label}` : position.label,
    coveredNumbers: position.numbers,
    payoutMultiplier: ruleset.payoutRatios[position.type],
    stake: 0,
    chipCount: 0,
    allocations: [],
    validationStatus: "empty",
    validationMessage: "No chips placed yet.",
    settlementStatus: "pending",
    winningProfit: 0,
    returnedStake: 0,
    totalPayout: 0,
    lostStake: 0,
  };
}

/** Recomputes the derived fields and checks the bet. */
export function validateBet(bet: BetPosition, ruleset: Ruleset): BetPosition {
  const stake = stakeOf(bet.allocations);
  const chipCount = chipCountOf(bet.allocations);
  let status: BetPosition["validationStatus"] = "valid";
  let message: string | null = null;
  if (!isPositionEnabled(ruleset, bet.key)) {
    status = "invalid";
    message = "This table does not offer this bet.";
  } else if (chipCount === 0 || stake === 0) {
    status = "empty";
    message = "No chips placed yet.";
  }
  return { ...bet, stake, chipCount, validationStatus: status, validationMessage: message };
}

export interface BetOpResult {
  inventory: ChipDenomination[];
  bets: BetPosition[];
}

/**
 * Sets how many chips of one denomination are on a position. The position is
 * created the first time chips are added and removed when its last chip is
 * taken off. Chips are reserved from the inventory so the same physical chip
 * can never sit on two positions.
 */
export function setPositionChips(
  inventory: ChipDenomination[],
  bets: BetPosition[],
  roundId: string,
  positionKey: string,
  denominationId: string,
  quantity: number,
  ruleset: Ruleset,
): BetOpResult {
  if (!Number.isInteger(quantity)) throw new BettingError("The number of chips must be a whole number.");
  if (quantity < 0) throw new BettingError("The number of chips cannot be below zero.");
  const den = inventory.find((d) => d.id === denominationId);
  if (!den) throw new BettingError("That chip value is not in your chips.");
  const position = getPosition(positionKey);
  if (!position) throw new BettingError("That betting position does not exist.");

  const id = betIdFor(roundId, positionKey);
  let working = bets;
  let bet = working.find((b) => b.id === id);
  if (!bet) {
    if (quantity === 0) return { inventory, bets };
    bet = newBet(roundId, position, ruleset);
    working = [...working, bet];
  }
  const existing = bet.allocations.find((a) => a.denominationId === denominationId);
  const delta = quantity - (existing?.quantity ?? 0);
  let inv = inventory;
  if (delta !== 0) {
    try {
      inv = reserveChips(inventory, denominationId, delta);
    } catch (e) {
      if (e instanceof InventoryError) {
        throw new BettingError(delta > 0 ? `You only have ${den.availableCount} more of these chips to place.` : e.message);
      }
      throw e;
    }
  }

  let allocations: ChipAllocation[];
  if (quantity === 0) {
    allocations = bet.allocations.filter((a) => a.denominationId !== denominationId);
  } else if (existing) {
    allocations = bet.allocations.map((a) =>
      a.denominationId === denominationId ? { ...a, quantity, totalValue: quantity * a.denominationValue } : a,
    );
  } else {
    allocations = [
      ...bet.allocations,
      {
        id: `${bet.id}:${denominationId}`,
        roundId,
        betId: bet.id,
        denominationId,
        denominationValue: den.value,
        quantity,
        totalValue: quantity * den.value,
      },
    ].sort((a, b) => a.denominationValue - b.denominationValue);
  }
  if (allocations.length === 0) return { inventory: inv, bets: working.filter((b) => b.id !== id) };
  const updated = validateBet({ ...bet, allocations }, ruleset);
  return { inventory: inv, bets: working.map((b) => (b.id === id ? updated : b)) };
}

/** Removes a bet and returns all of its chips to the available pool. */
export function removeBetFromPlan(inventory: ChipDenomination[], bets: BetPosition[], betId: string): BetOpResult {
  const bet = bets.find((b) => b.id === betId);
  if (!bet) throw new BettingError("Bet not found.");
  let inv = inventory;
  for (const a of bet.allocations) inv = reserveChips(inv, a.denominationId, -a.quantity);
  return { inventory: inv, bets: bets.filter((b) => b.id !== betId) };
}

/** Releases every reservation (clearing a draft). */
export function releaseAll(inventory: ChipDenomination[], bets: BetPosition[]): ChipDenomination[] {
  let inv = inventory;
  for (const b of bets) for (const a of b.allocations) inv = reserveChips(inv, a.denominationId, -a.quantity);
  return inv;
}

/** Re-validates every bet (e.g. after the table rules change). Never alters stakes. */
export function revalidateBets(bets: BetPosition[], ruleset: Ruleset): BetPosition[] {
  return bets.map((b) =>
    validateBet({ ...b, payoutMultiplier: ruleset.payoutRatios[b.betType] }, ruleset),
  );
}

export interface RoundTotals {
  totalBet: number;
  totalChips: number;
  positions: number;
}

export function roundTotals(bets: BetPosition[]): RoundTotals {
  return {
    totalBet: bets.reduce((s, b) => s + b.stake, 0),
    totalChips: bets.reduce((s, b) => s + b.chipCount, 0),
    positions: bets.length,
  };
}

/** Plain-language problems that block continuing. */
export function roundProblems(bets: BetPosition[]): string[] {
  const problems: string[] = [];
  if (bets.length === 0) problems.push("Choose at least one bet and place some chips on it.");
  for (const b of bets) {
    if (b.validationStatus === "invalid") problems.push(`${b.label}: ${b.validationMessage ?? "this bet is not valid."}`);
    else if (b.validationStatus === "empty") problems.push(`${b.label}: no chips placed.`);
  }
  return problems;
}

/* ───────── "Last round + more" for many bets at once ───────── */

/** The bet types the Add Chips button can raise: straights, splits, corners, streets and double streets. */
export const BULK_TYPES = ["straight", "split", "corner", "street", "sixLine"] as const;
export type BulkType = (typeof BULK_TYPES)[number];
export type BulkExtra = Record<BulkType, number>;

export const emptyBulkExtra = (): BulkExtra => ({ straight: 0, split: 0, corner: 0, street: 0, sixLine: 0 });

export interface PreviousPlusResult extends BetOpResult {
  /** how many bets were set */
  changed: number;
}

/**
 * Sets every bet that had chips LAST round (and is allowed now) to
 *   last round's chips (same chip values) + `extra[type]` chips of one chosen value.
 * Chips already on those bets are replaced, so applying twice gives the same result.
 * Bets that did not have chips last round, outside bets and zero bets are untouched.
 * All-or-nothing: if the chips are not enough, an error says how many are missing
 * and nothing changes.
 */
export function previousPlusChips(args: {
  inventory: ChipDenomination[];
  bets: BetPosition[];
  roundId: string;
  previousBets: BetPosition[];
  /** positions that may be set (the ones shown for the current main numbers) */
  allowedKeys: Set<string>;
  extra: BulkExtra;
  extraDenominationId: string;
  ruleset: Ruleset;
  /** formats an amount in the session currency, for messages */
  fmt: (minor: number) => string;
}): PreviousPlusResult {
  const { previousBets, allowedKeys, extra, extraDenominationId, ruleset, roundId, fmt } = args;
  for (const t of BULK_TYPES) {
    if (!Number.isInteger(extra[t]) || extra[t] < 0) throw new BettingError("The extra chips must be a whole number, zero or more.");
  }
  const bulk = new Set<string>(BULK_TYPES);
  const affected = previousBets.filter((b) => bulk.has(b.betType) && allowedKeys.has(b.key) && isPositionEnabled(ruleset, b.key));
  if (affected.length === 0)
    throw new BettingError("None of last round's straight, split, corner, street or double street bets are among your current main numbers.");

  // 1. free the chips that are on those bets now
  let inv = args.inventory;
  let bets = args.bets;
  for (const b of affected) {
    const id = betIdFor(roundId, b.key);
    if (bets.some((x) => x.id === id)) {
      const r = removeBetFromPlan(inv, bets, id);
      inv = r.inventory;
      bets = r.bets;
    }
  }

  // 2. what each bet needs, by chip
  const extraDen = inv.find((d) => d.id === extraDenominationId);
  if (!extraDen) throw new BettingError("Choose which chip value to add.");
  const targets = new Map<string, Map<string, number>>(); // key -> denomination id -> quantity
  const needed = new Map<string, number>(); // denomination id -> total quantity
  const add = (key: string, denId: string, qty: number) => {
    if (qty <= 0) return;
    const m = targets.get(key) ?? new Map<string, number>();
    m.set(denId, (m.get(denId) ?? 0) + qty);
    targets.set(key, m);
    needed.set(denId, (needed.get(denId) ?? 0) + qty);
  };
  for (const b of affected) {
    for (const a of b.allocations) {
      const den = inv.find((d) => d.value === a.denominationValue);
      if (!den) throw new BettingError(`You no longer have ${fmt(a.denominationValue)} chips, which last round's bets used. Add them under Change My Chips first.`);
      add(b.key, den.id, a.quantity);
    }
    add(b.key, extraDen.id, extra[b.betType as BulkType]);
  }

  // 3. enough chips?
  const short: string[] = [];
  for (const [denId, qty] of needed) {
    const den = inv.find((d) => d.id === denId)!;
    if (qty > den.availableCount) short.push(`${qty - den.availableCount} more ${fmt(den.value)} chips`);
  }
  if (short.length) throw new BettingError(`You do not have enough chips. You need ${short.join(" and ")}.`);

  // 4. place them
  for (const [key, perDen] of targets) {
    for (const [denId, qty] of perDen) {
      const r = setPositionChips(inv, bets, roundId, key, denId, qty, ruleset);
      inv = r.inventory;
      bets = r.bets;
    }
  }
  return { inventory: inv, bets, changed: affected.length };
}
