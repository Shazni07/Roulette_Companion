import type { ChipDenomination } from "./types";

let counter = 0;
export function newId(prefix = "id"): string {
  counter = (counter + 1) % 1_000_000;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export interface InventoryTotals {
  /** available + allocated */
  totalChips: number;
  totalValue: number;
  availableChips: number;
  availableValue: number;
  allocatedChips: number;
  allocatedValue: number;
}

export function inventoryTotals(inv: ChipDenomination[]): InventoryTotals {
  let availableChips = 0;
  let availableValue = 0;
  let allocatedChips = 0;
  let allocatedValue = 0;
  for (const d of inv) {
    availableChips += d.availableCount;
    availableValue += d.availableCount * d.value;
    allocatedChips += d.allocatedCount;
    allocatedValue += d.allocatedCount * d.value;
  }
  return {
    totalChips: availableChips + allocatedChips,
    totalValue: availableValue + allocatedValue,
    availableChips,
    availableValue,
    allocatedChips,
    allocatedValue,
  };
}

/** Value of the (initial) setup entries: Σ value × count. */
export function setupTotals(entries: { value: number; count: number }[]) {
  let chips = 0;
  let value = 0;
  for (const e of entries) {
    chips += e.count;
    value += e.value * e.count;
  }
  return { chips, value };
}

export function validateDenominationValue(
  inv: { id?: string; value: number }[],
  value: number,
  excludeId?: string,
): string | null {
  if (!Number.isSafeInteger(value) || value <= 0) return "Denomination must be a positive amount.";
  if (inv.some((d) => d.value === value && d.id !== excludeId))
    return "This denomination already exists. Edit its quantity instead of adding it twice.";
  return null;
}

export function validateQuantity(q: number): string | null {
  if (!Number.isInteger(q)) return "Chip quantity must be a whole number.";
  if (q < 0) return "Chip quantity cannot be negative.";
  if (q > 1_000_000) return "Chip quantity is unrealistically large.";
  return null;
}

/** Builds a fresh inventory from setup entries (validated). */
export function createInventory(entries: { value: number; count: number }[]): ChipDenomination[] {
  const out: ChipDenomination[] = [];
  for (const e of entries) {
    const vErr = validateDenominationValue(out, e.value);
    if (vErr) throw new InventoryError(vErr);
    const qErr = validateQuantity(e.count);
    if (qErr) throw new InventoryError(qErr);
    out.push({
      id: newId("den"),
      value: e.value,
      initialCount: e.count,
      availableCount: e.count,
      allocatedCount: 0,
    });
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Reserves `qty` chips of a denomination (qty may be negative to release). */
export function reserveChips(inv: ChipDenomination[], denominationId: string, qty: number): ChipDenomination[] {
  if (!Number.isInteger(qty)) throw new InventoryError("Chip quantity must be a whole number.");
  const d = inv.find((x) => x.id === denominationId);
  if (!d) throw new InventoryError("Unknown chip denomination.");
  if (qty > d.availableCount)
    throw new InventoryError(`Not enough chips: only ${d.availableCount} of this denomination available.`);
  if (qty < 0 && -qty > d.allocatedCount)
    throw new InventoryError("Cannot release more chips than are currently allocated.");
  return inv.map((x) =>
    x.id === denominationId
      ? { ...x, availableCount: x.availableCount - qty, allocatedCount: x.allocatedCount + qty }
      : x,
  );
}

/** Verifies the structural invariants of an inventory. */
export function checkInventory(inv: ChipDenomination[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const d of inv) {
    if (!Number.isInteger(d.availableCount) || d.availableCount < 0)
      problems.push(`Denomination ${d.value}: invalid available count.`);
    if (!Number.isInteger(d.allocatedCount) || d.allocatedCount < 0)
      problems.push(`Denomination ${d.value}: invalid allocated count.`);
    if (seen.has(d.value)) problems.push(`Duplicate denomination ${d.value}.`);
    seen.add(d.value);
  }
  return problems;
}

/**
 * Indicative greedy breakdown of an amount into the given denominations.
 * This is a SUGGESTION only – never treated as verified inventory.
 */
export function suggestBreakdown(amount: number, values: { id: string; value: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  let rest = amount;
  for (const d of [...values].sort((a, b) => b.value - a.value)) {
    const q = Math.floor(rest / d.value);
    if (q > 0) {
      out[d.id] = q;
      rest -= q * d.value;
    }
  }
  return out;
}

/**
 * How many chips of one value the money left can be turned into (whole chips only).
 * Example: Rs. 1,000 left and Rs. 200 chips -> 5.
 */
export function suggestChipCount(moneyLeft: number, chipValue: number): number {
  if (!Number.isSafeInteger(moneyLeft) || !Number.isSafeInteger(chipValue) || chipValue <= 0 || moneyLeft <= 0) return 0;
  return Math.floor(moneyLeft / chipValue);
}
