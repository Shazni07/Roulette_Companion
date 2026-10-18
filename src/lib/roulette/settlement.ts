import { isValidNumber } from "./rules";
import type { BetPosition, SettlementResult } from "./types";

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

/**
 * Pure settlement. Every position is settled independently against its own
 * covered-number set. Multipliers are PROFIT ratios: a winning stake S returns
 * S + S×m, of which only S×m is profit.
 *
 * La Partage / En Prison are intentionally not applied (unsupported) – zero is a
 * plain loss for every position that does not cover it.
 */
export function settleBets(bets: BetPosition[], winningNumber: number): SettlementResult {
  if (!isValidNumber(winningNumber)) throw new SettlementError("Winning number must be a whole number from 0 to 36.");
  if (bets.length === 0) throw new SettlementError("There are no bets to settle.");

  let totalBet = 0;
  let totalChips = 0;
  let winningStake = 0;
  let losingStake = 0;
  let winningChips = 0;
  let losingChips = 0;
  let winningPositions = 0;
  let losingPositions = 0;
  let grossWinningProfit = 0;
  let totalPayout = 0;

  const results = bets.map((b) => {
    if (b.stake <= 0) throw new SettlementError(`${b.label}: zero-value bet cannot be settled.`);
    totalBet += b.stake;
    totalChips += b.chipCount;
    if (b.coveredNumbers.includes(winningNumber)) {
      const profit = b.stake * b.payoutMultiplier;
      const payout = b.stake + profit;
      winningPositions++;
      winningStake += b.stake;
      winningChips += b.chipCount;
      grossWinningProfit += profit;
      totalPayout += payout;
      return { betId: b.id, status: "win" as const, profit, returnedStake: b.stake, totalPayout: payout, lostStake: 0 };
    }
    losingPositions++;
    losingStake += b.stake;
    losingChips += b.chipCount;
    return { betId: b.id, status: "loss" as const, profit: 0, returnedStake: 0, totalPayout: 0, lostStake: b.stake };
  });

  const grossLoss = losingStake;
  const netResult = totalPayout - totalBet;
  // Internal consistency (both definitions of net must agree)
  if (netResult !== grossWinningProfit - grossLoss)
    throw new SettlementError("Internal accounting mismatch while settling.");

  return {
    winningNumber,
    bets: results,
    totalBet,
    totalChips,
    winningStake,
    losingStake,
    winningChips,
    losingChips,
    winningPositions,
    losingPositions,
    grossWinningProfit,
    grossLoss,
    totalPayout,
    netResult,
  };
}

export interface ScenarioResult {
  /** profit from every bet that covers the number (stakes come back, so they are not counted) */
  won: number;
  /** stakes lost on every bet that does not cover the number */
  lost: number;
  /** won − lost: the player's net result if this number is the winning number */
  net: number;
}

/**
 * "What if this number comes up?" – the net result of the WHOLE round for one
 * possible winning number: every bet that covers it (straight, splits, corners,
 * streets, double streets, zero bets and outside bets alike) pays its profit, and
 * every bet that does not cover it loses its stake. Equal to settleBets(...).netResult.
 */
export function resultIfNumberWins(bets: BetPosition[], winningNumber: number): ScenarioResult {
  let won = 0;
  let lost = 0;
  for (const b of bets) {
    if (b.coveredNumbers.includes(winningNumber)) won += b.stake * b.payoutMultiplier;
    else lost += b.stake;
  }
  return { won, lost, net: won - lost };
}
