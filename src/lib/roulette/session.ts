import {
  InventoryError,
  inventoryTotals,
  newId,
  validateDenominationValue,
  validateQuantity,
} from "./inventory";
import { createDefaultRuleset } from "./rules";
import type {
  Currency,
  InventoryTransaction,
  MoneyAddition,
  Round,
  Session,
} from "./types";

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export function createSession(currency: Currency, startingMoney: number, symbol?: string): Session {
  if (!Number.isSafeInteger(startingMoney) || startingMoney <= 0) throw new SessionError("Please enter an amount above zero.");
  return {
    id: newId("session"),
    startedAt: Date.now(),
    finishedAt: null,
    currency,
    currencySymbol: symbol,
    startingMoney,
    additions: [],
    ruleset: createDefaultRuleset(),
    initialInventory: [],
    inventory: [],
    totalRounds: 0,
    sessionStatus: "setup",
    setupStep: "chips",
  };
}

export const totalAdded = (s: Session) => s.additions.reduce((t, a) => t + a.amount, 0);

/** Profit or loss of all saved rounds of the session together (negative = loss). Added money is not profit. */
export function totalProfitLoss(session: Session, rounds: Round[]): number {
  return rounds.filter((r) => r.sessionId === session.id && r.roundStatus === "completed").reduce((t, r) => t + r.netResult, 0);
}

export interface AllRoundsTotals {
  rounds: number;
  moneyBet: number;
  /** profit from winning bets (the chips on them come back, so they are not counted) */
  moneyWon: number;
  /** stakes lost on losing bets */
  moneyLost: number;
  /** moneyWon − moneyLost */
  net: number;
  chipsPlaced: number;
  chipsLost: number;
  /** chips that were on winning bets */
  chipsWon: number;
}

/**
 * Totals over every saved round of the session. `including` adds one more round
 * that has a result but is not saved yet (the Round Result screen).
 */
export function allRoundsTotals(session: Session, rounds: Round[], including?: Round): AllRoundsTotals {
  const list = rounds.filter((r) => r.sessionId === session.id && r.roundStatus === "completed");
  if (including && !list.some((r) => r.id === including.id)) list.push(including);
  const t: AllRoundsTotals = { rounds: list.length, moneyBet: 0, moneyWon: 0, moneyLost: 0, net: 0, chipsPlaced: 0, chipsLost: 0, chipsWon: 0 };
  for (const r of list) {
    t.moneyBet += r.totalBet;
    t.moneyWon += r.grossWinningProfit;
    t.moneyLost += r.grossLoss;
    t.chipsPlaced += r.totalChips;
    t.chipsLost += r.losingChips;
    t.chipsWon += r.winningChips;
  }
  t.net = t.moneyWon - t.moneyLost;
  return t;
}

/**
 * Money balance = starting money + money added later + net result of every saved
 * round. It is derived (never stored separately) and is NOT the value of the
 * chips, which is tracked on its own, so nothing is counted twice.
 */
export function sessionBalance(session: Session, rounds: Round[]): number {
  const net = rounds.filter((r) => r.sessionId === session.id && r.roundStatus === "completed").reduce((t, r) => t + r.netResult, 0);
  return session.startingMoney + totalAdded(session) + net;
}

export function addMoney(session: Session, amount: number): { session: Session; transaction: InventoryTransaction } {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new SessionError("Please enter an amount above zero.");
  const addition: MoneyAddition = { id: newId("add"), at: Date.now(), amount };
  return {
    session: { ...session, additions: [...session.additions, addition] },
    transaction: {
      id: newId("tx"),
      sessionId: session.id,
      roundId: null,
      denominationId: null,
      transactionType: "money-added",
      quantityChange: 0,
      monetaryChange: amount,
      createdAt: addition.at,
      reason: "More money added to the session",
    },
  };
}

/* ───────── chips the player holds ───────── */

function chipTx(session: Session, denId: string | null, qty: number, money: number, reason: string, type: InventoryTransaction["transactionType"] = "chips-edit"): InventoryTransaction {
  return { id: newId("tx"), sessionId: session.id, roundId: null, denominationId: denId, transactionType: type, quantityChange: qty, monetaryChange: money, createdAt: Date.now(), reason };
}

export function addChipType(session: Session, value: number, count: number): { session: Session; transaction: InventoryTransaction } {
  const vErr = validateDenominationValue(session.inventory, value);
  if (vErr) throw new InventoryError(vErr);
  const qErr = validateQuantity(count);
  if (qErr) throw new InventoryError(qErr);
  const den = { id: newId("den"), value, initialCount: count, availableCount: count, allocatedCount: 0 };
  return {
    session: { ...session, inventory: [...session.inventory, den].sort((a, b) => a.value - b.value) },
    transaction: chipTx(session, den.id, count, count * value, "Chip type added", session.initialInventory.length === 0 && session.totalRounds === 0 ? "initial" : "chips-edit"),
  };
}

export function editChipType(
  session: Session,
  id: string,
  patch: { value?: number; count?: number },
): { session: Session; transaction: InventoryTransaction } {
  const d = session.inventory.find((x) => x.id === id);
  if (!d) throw new InventoryError("That chip is not in your list.");
  const next = { ...d };
  if (patch.value !== undefined && patch.value !== d.value) {
    if (d.allocatedCount > 0) throw new InventoryError("These chips are on a bet right now. Take them off the bet before changing their value.");
    const err = validateDenominationValue(session.inventory, patch.value, id);
    if (err) throw new InventoryError(err);
    next.value = patch.value;
  }
  if (patch.count !== undefined && patch.count !== d.availableCount) {
    const err = validateQuantity(patch.count);
    if (err) throw new InventoryError(err);
    next.availableCount = patch.count;
  }
  const qty = next.availableCount - d.availableCount;
  return {
    session: { ...session, inventory: session.inventory.map((x) => (x.id === id ? next : x)).sort((a, b) => a.value - b.value) },
    transaction: chipTx(session, id, qty, qty * next.value, "Chips changed by the user"),
  };
}

export function removeChipType(session: Session, id: string): { session: Session; transaction: InventoryTransaction } {
  const d = session.inventory.find((x) => x.id === id);
  if (!d) throw new InventoryError("That chip is not in your list.");
  if (d.allocatedCount > 0) throw new InventoryError("These chips are on a bet right now. Take them off the bet first.");
  return {
    session: { ...session, inventory: session.inventory.filter((x) => x.id !== id) },
    transaction: chipTx(session, id, -d.availableCount, -d.availableCount * d.value, "Chip type removed"),
  };
}

/** Finishes the chip step: remembers what the player started with and opens the session. */
export function chipsDone(session: Session): Session {
  if (session.inventory.length === 0) throw new InventoryError("Please enter at least one kind of chip.");
  if (inventoryTotals(session.inventory).totalChips === 0) throw new InventoryError("Please enter how many chips you have.");
  return {
    ...session,
    initialInventory: session.inventory.map((d) => ({ value: d.value, count: d.availableCount })),
    setupStep: "done",
    sessionStatus: "active",
  };
}
