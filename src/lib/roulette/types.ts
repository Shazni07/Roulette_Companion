/**
 * Domain types. All monetary values are INTEGER MINOR UNITS (1/100 of the major
 * currency unit) so floating-point arithmetic is never applied to money.
 */

/** A currency code such as "LKR". LKR, INR and USD are built in; more can be added on the start page. */
export type Currency = string;
export type Colour = "red" | "black" | "green";

export type BetType =
  | "straight"
  | "split"
  | "street"
  | "corner"
  | "sixLine"
  | "zeroTrio"
  | "firstFour"
  | "dozen"
  | "low"
  | "high"
  | "red"
  | "black"
  | "odd"
  | "even";

/** "inside" covers every inside position including the explicit zero areas. */
export type BetCategory = "inside" | "outside";

export interface Ruleset {
  id: string;
  name: string;
  wheelType: "single-zero";
  numberToColour: Record<number, Colour>;
  supportedBetTypes: BetType[];
  /** Profit multipliers (profit : 1). */
  payoutRatios: Record<BetType, number>;
  /** Zero-specific areas this table offers. */
  supportedZeroBets: { zeroSplits: boolean; zeroTrios: boolean; firstFour: boolean };
  /** Not implemented – always false and never offered. */
  specialZeroRules: { laPartage: false; enPrison: false };
}

/** A physical betting position with one unique identity (type + covered numbers). */
export interface Position {
  key: string;
  type: BetType;
  category: BetCategory;
  label: string;
  /** Short plain-language name, e.g. "Split". */
  typeLabel: string;
  numbers: number[]; // sorted ascending
}

export interface ChipDenomination {
  id: string;
  value: number; // minor units
  initialCount: number;
  /** Chips not currently reserved by a bet. */
  availableCount: number;
  /** Chips reserved by the current round's bets. */
  allocatedCount: number;
}

export interface ChipAllocation {
  id: string;
  roundId: string;
  betId: string;
  denominationId: string;
  denominationValue: number;
  quantity: number;
  totalValue: number;
}

export type ValidationStatus = "valid" | "invalid" | "empty";
export type SettlementStatus = "pending" | "win" | "loss";

export interface BetPosition {
  id: string;
  roundId: string;
  key: string;
  betType: BetType;
  category: BetCategory;
  label: string;
  coveredNumbers: number[];
  payoutMultiplier: number;
  stake: number;
  chipCount: number;
  allocations: ChipAllocation[];
  validationStatus: ValidationStatus;
  validationMessage: string | null;
  settlementStatus: SettlementStatus;
  winningProfit: number;
  returnedStake: number;
  totalPayout: number;
  lostStake: number;
}

/**
 * setup → selecting numbers (draft) → planning bets → confirmed → awaiting
 * winning number → result calculated (settled) → saved (completed) | cancelled.
 */
export type RoundStatus =
  | "draft"
  | "planning"
  | "confirmed"
  | "awaiting-result"
  | "settled"
  | "completed"
  | "cancelled";

/** estimated: not checked by the user · verified: user confirmed · adjusted: user changed counts. */
export type ReconciliationStatus = "pending" | "estimated" | "verified" | "adjusted";

export interface AuditEntry {
  at: number;
  action: string;
  note: string;
}

export interface Round {
  id: string;
  sessionId: string;
  roundNumber: number;
  createdAt: number;
  confirmedAt: number | null;
  settledAt: number | null;
  completedAt: number | null;
  selectedMainNumbers: number[];
  rulesetSnapshot: Ruleset | null;
  winningNumber: number | null;
  bets: BetPosition[];
  totalBet: number;
  totalChips: number;
  totalWinningStake: number;
  totalLosingStake: number;
  winningChips: number;
  losingChips: number;
  grossWinningProfit: number;
  grossLoss: number;
  totalPayout: number;
  netResult: number;
  /** Session money balance before / after this round (set when saved). */
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** Physical chips snapshot after the round (set when saved). */
  inventoryAfter: { value: number; count: number }[] | null;
  reconciliationStatus: ReconciliationStatus;
  roundStatus: RoundStatus;
  audit: AuditEntry[];
  /** Set when saved on this phone; used to decide which copy is newest when syncing online. */
  updatedAt?: number;
}

export interface MoneyAddition {
  id: string;
  at: number;
  amount: number;
}

export type SessionStatus = "setup" | "active" | "finished";
export type SetupStep = "money" | "chips" | "done";

export interface Session {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  currency: Currency;
  /** Symbol shown before amounts, e.g. "Rs. " or "€". */
  currencySymbol?: string;
  /** The original amount the user decided to use. Never overwritten. */
  startingMoney: number;
  /** Extra money added later, each recorded separately. */
  additions: MoneyAddition[];
  ruleset: Ruleset;
  initialInventory: { value: number; count: number }[];
  inventory: ChipDenomination[];
  totalRounds: number;
  sessionStatus: SessionStatus;
  setupStep: SetupStep;
  /** Optional reminders (minor units): stop when total profit reaches stopWin, or total loss reaches stopLoss. */
  stopWin?: number | null;
  stopLoss?: number | null;
  /** Set when saved on this phone; used to decide which copy is newest when syncing online. */
  updatedAt?: number;
}

export type TransactionType = "initial" | "money-added" | "chips-edit" | "round-result" | "adjustment";

export interface InventoryTransaction {
  id: string;
  sessionId: string;
  roundId: string | null;
  denominationId: string | null;
  transactionType: TransactionType;
  quantityChange: number;
  monetaryChange: number;
  createdAt: number;
  reason: string;
  updatedAt?: number;
}

export interface SettlementBetResult {
  betId: string;
  status: "win" | "loss";
  profit: number;
  returnedStake: number;
  totalPayout: number;
  lostStake: number;
}

export interface SettlementResult {
  winningNumber: number;
  bets: SettlementBetResult[];
  totalBet: number;
  totalChips: number;
  winningStake: number;
  losingStake: number;
  winningChips: number;
  losingChips: number;
  winningPositions: number;
  losingPositions: number;
  grossWinningProfit: number;
  grossLoss: number;
  totalPayout: number;
  netResult: number;
}
