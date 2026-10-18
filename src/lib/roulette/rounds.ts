import { releaseAll, roundProblems, roundTotals } from "./betting";
import { estimateHoldings } from "./chips";
import { InventoryError, newId } from "./inventory";
import { isValidNumber } from "./rules";
import { sessionBalance } from "./session";
import { settleBets } from "./settlement";
import type { InventoryTransaction, Round, RoundStatus, Session } from "./types";

export class RoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoundError";
  }
}

/** Valid round transitions. Enforced by the logic, not merely by hiding buttons. */
export const ALLOWED_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["draft", "confirmed", "cancelled"],
  confirmed: ["awaiting-result", "planning"],
  "awaiting-result": ["settled", "planning"],
  settled: ["awaiting-result", "completed"],
  completed: [],
  cancelled: [],
};

export const canTransition = (from: RoundStatus, to: RoundStatus) => ALLOWED_TRANSITIONS[from].includes(to);

export function transition(round: Round, to: RoundStatus, note = ""): Round {
  if (!canTransition(round.roundStatus, to)) throw new RoundError(`This round cannot move from "${round.roundStatus}" to "${to}".`);
  return { ...round, roundStatus: to, audit: [...round.audit, { at: Date.now(), action: `${round.roundStatus} → ${to}`, note }] };
}

export function createRound(session: Session, roundNumber: number): Round {
  return {
    id: newId("round"),
    sessionId: session.id,
    roundNumber,
    createdAt: Date.now(),
    confirmedAt: null,
    settledAt: null,
    completedAt: null,
    selectedMainNumbers: [],
    rulesetSnapshot: null,
    winningNumber: null,
    bets: [],
    totalBet: 0,
    totalChips: 0,
    totalWinningStake: 0,
    totalLosingStake: 0,
    winningChips: 0,
    losingChips: 0,
    grossWinningProfit: 0,
    grossLoss: 0,
    totalPayout: 0,
    netResult: 0,
    balanceBefore: null,
    balanceAfter: null,
    inventoryAfter: null,
    reconciliationStatus: "pending",
    roundStatus: "draft",
    audit: [],
  };
}

export const isEditable = (r: Round) => r.roundStatus === "draft" || r.roundStatus === "planning";

export function assertEditable(r: Round): void {
  if (!isEditable(r)) throw new RoundError("This round is confirmed. Go back and choose Edit Bets to change it.");
}

export function setMainNumbers(round: Round, numbers: number[]): Round {
  assertEditable(round);
  for (const n of numbers) if (!isValidNumber(n)) throw new RoundError(`${n} is not a roulette number.`);
  const uniq = [...new Set(numbers)].sort((a, b) => a - b);
  let r: Round = { ...round, selectedMainNumbers: uniq };
  if (r.roundStatus === "draft" && uniq.length > 0) r = transition(r, "planning");
  if (r.roundStatus === "planning" && uniq.length === 0 && r.bets.length === 0) r = transition(r, "draft");
  return r;
}

export function withTotals(round: Round): Round {
  const t = roundTotals(round.bets);
  return { ...round, totalBet: t.totalBet, totalChips: t.totalChips };
}

function checkReservations(session: Session, round: Round): void {
  const byDen = new Map<string, number>();
  for (const b of round.bets) for (const a of b.allocations) byDen.set(a.denominationId, (byDen.get(a.denominationId) ?? 0) + a.quantity);
  for (const d of session.inventory) {
    if ((byDen.get(d.id) ?? 0) !== d.allocatedCount)
      throw new RoundError("The chips on your bets do not match your chip list. Clear this round and place the chips again.");
  }
}

/** Confirms the plan: saves a snapshot and locks it against accidental edits. */
export function confirmRound(session: Session, round: Round): Round {
  if (round.roundStatus !== "planning") throw new RoundError("Choose your bets first.");
  const problems = roundProblems(round.bets);
  if (problems.length) throw new RoundError(problems[0]!);
  checkReservations(session, round);
  let r = withTotals(round);
  r = {
    ...r,
    confirmedAt: Date.now(),
    rulesetSnapshot: JSON.parse(JSON.stringify(session.ruleset)),
  };
  r = transition(r, "confirmed", "Betting plan confirmed");
  return transition(r, "awaiting-result", "Waiting for the winning number");
}

/** Controlled way back to the plan before a result is entered. */
export function reopenRound(round: Round, reason: string): Round {
  if (round.roundStatus !== "awaiting-result" && round.roundStatus !== "confirmed")
    throw new RoundError("Bets can only be edited before the result is calculated.");
  const r = transition(round, "planning", `Returned to edit bets: ${reason.trim() || "no reason given"}`);
  return { ...r, confirmedAt: null, rulesetSnapshot: null };
}

export function settleRound(round: Round, winningNumber: number): Round {
  if (round.roundStatus === "settled" || round.roundStatus === "completed") throw new RoundError("This round already has a result.");
  if (round.roundStatus !== "awaiting-result") throw new RoundError("Confirm your bets before entering the winning number.");
  if (!isValidNumber(winningNumber)) throw new RoundError("The winning number must be from 0 to 36.");
  const res = settleBets(round.bets, winningNumber);
  const byId = new Map(res.bets.map((b) => [b.betId, b]));
  const bets = round.bets.map((b) => {
    const s = byId.get(b.id)!;
    return { ...b, settlementStatus: s.status, winningProfit: s.profit, returnedStake: s.returnedStake, totalPayout: s.totalPayout, lostStake: s.lostStake };
  });
  const r: Round = {
    ...round,
    bets,
    winningNumber,
    totalBet: res.totalBet,
    totalChips: res.totalChips,
    totalWinningStake: res.winningStake,
    totalLosingStake: res.losingStake,
    winningChips: res.winningChips,
    losingChips: res.losingChips,
    grossWinningProfit: res.grossWinningProfit,
    grossLoss: res.grossLoss,
    totalPayout: res.totalPayout,
    netResult: res.netResult,
    settledAt: Date.now(),
  };
  return transition(r, "settled", `Winning number ${winningNumber}`);
}

/** Explicit, recorded correction of a result that has not been saved yet. */
export function reverseSettlement(round: Round, reason: string): Round {
  if (round.roundStatus !== "settled") throw new RoundError("Only a result that has not been saved can be corrected.");
  const r = transition(round, "awaiting-result", `Result undone: ${reason.trim() || "no reason given"}`);
  return {
    ...r,
    winningNumber: null,
    settledAt: null,
    totalWinningStake: 0,
    totalLosingStake: 0,
    winningChips: 0,
    losingChips: 0,
    grossWinningProfit: 0,
    grossLoss: 0,
    totalPayout: 0,
    netResult: 0,
    bets: r.bets.map((b) => ({ ...b, settlementStatus: "pending", winningProfit: 0, returnedStake: 0, totalPayout: 0, lostStake: 0 })),
  };
}

export interface Completion {
  session: Session;
  round: Round;
  transactions: InventoryTransaction[];
}

/**
 * Saves a result: updates the chips the player holds and records the money
 * balance. `finalCounts` are the chips the player says they hold (by chip id);
 * without them the estimate is used. The money ledger is never altered to hide a
 * difference between the estimate and the real chips – the difference is
 * recorded as a separate adjustment.
 */
export function completeRound(
  session: Session,
  round: Round,
  allRounds: Round[],
  opts: { finalCounts?: Record<string, number>; confirmedByUser?: boolean } = {},
): Completion {
  if (round.roundStatus === "completed") throw new RoundError("This round was already saved.");
  if (round.roundStatus !== "settled") throw new RoundError("Calculate the result before saving the round.");
  if (allRounds.some((r) => r.id !== round.id && r.sessionId === session.id && r.roundStatus === "completed" && r.roundNumber === round.roundNumber))
    throw new RoundError("A round with this number was already saved.");

  const est = estimateHoldings(session.inventory, round.bets);
  const finalCounts = opts.finalCounts ?? Object.fromEntries(est.estimated.map((d) => [d.id, d.availableCount]));
  for (const d of est.estimated) {
    const q = finalCounts[d.id];
    if (q === undefined || !Number.isInteger(q) || q < 0) throw new RoundError("Please enter a whole number of chips (zero or more) for every chip value.");
  }
  const changed = est.estimated.some((d) => finalCounts[d.id] !== d.availableCount);
  const status = changed ? "adjusted" : opts.confirmedByUser ? "verified" : "estimated";

  const now = Date.now();
  const txs: InventoryTransaction[] = [];
  const inventory = est.estimated.map((d) => {
    const original = session.inventory.find((x) => x.id === d.id)!;
    const final = finalCounts[d.id]!;
    const resultQty = d.availableCount - (original.availableCount + original.allocatedCount);
    if (resultQty !== 0)
      txs.push({ id: newId("tx"), sessionId: session.id, roundId: round.id, denominationId: d.id, transactionType: "round-result", quantityChange: resultQty, monetaryChange: resultQty * d.value, createdAt: now, reason: `Round ${round.roundNumber}: chips lost and estimated winnings` });
    if (final !== d.availableCount)
      txs.push({ id: newId("tx"), sessionId: session.id, roundId: round.id, denominationId: d.id, transactionType: "adjustment", quantityChange: final - d.availableCount, monetaryChange: (final - d.availableCount) * d.value, createdAt: now, reason: `Round ${round.roundNumber}: chips counted by the user differ from the estimate` });
    return { ...d, availableCount: final, allocatedCount: 0 };
  });

  const before = sessionBalance(session, allRounds);
  const completed = transition(
    {
      ...round,
      completedAt: now,
      balanceBefore: before,
      balanceAfter: before + round.netResult,
      inventoryAfter: inventory.map((d) => ({ value: d.value, count: d.availableCount })),
      reconciliationStatus: status,
    },
    "completed",
    `Saved (${status})`,
  );
  return { session: { ...session, inventory, totalRounds: session.totalRounds + 1 }, round: completed, transactions: txs };
}

/** Clears an unconfirmed draft: releases reservations, keeps saved history. */
export function clearDraft(session: Session, round: Round): Completion {
  assertEditable(round);
  const now = Date.now();
  let inventory: Session["inventory"];
  try {
    inventory = releaseAll(session.inventory, round.bets);
  } catch (e) {
    if (e instanceof InventoryError) throw new RoundError("Could not release the chips: " + e.message);
    throw e;
  }
  const cleared: Round = {
    ...round,
    bets: [],
    selectedMainNumbers: [],
    totalBet: 0,
    totalChips: 0,
    winningNumber: null,
    roundStatus: "draft",
    audit: [...round.audit, { at: now, action: "draft cleared", note: `${round.totalChips} chips released` }],
  };
  return { session: { ...session, inventory }, round: cleared, transactions: [] };
}

export const hasDraftContent = (r: Round) => r.selectedMainNumbers.length > 0 || r.bets.length > 0;
