import type { BetPosition, ChipDenomination } from "./types";

export interface HoldingsEstimate {
  /** Inventory after the round: nothing reserved any more, winnings added as an ESTIMATE. */
  estimated: ChipDenomination[];
  /** chips on losing bets, by denomination id */
  lostById: Record<string, number>;
  /** estimated chips coming back from winning bets (stake + profit), by denomination id */
  returnedById: Record<string, number>;
  lostChips: number;
  lostValue: number;
  returnedChips: number;
  returnedValue: number;
}

/**
 * What the player should be holding after settlement, in chips.
 *
 * Chips on losing positions are gone. For a winning position every chip comes
 * back and is paid at the position's odds IN THE SAME CHIP VALUE:
 *   chips returned = quantity × (multiplier + 1)
 * This is always possible with the denominations used on the bet, and its value
 * is exactly stake × (multiplier + 1). It is an ESTIMATE – the casino may pay in
 * other denominations – so the user can correct the counts before saving.
 */
export function estimateHoldings(inventory: ChipDenomination[], bets: BetPosition[]): HoldingsEstimate {
  const lostById: Record<string, number> = {};
  const returnedById: Record<string, number> = {};
  let lostChips = 0;
  let lostValue = 0;
  let returnedChips = 0;
  let returnedValue = 0;
  for (const b of bets) {
    for (const a of b.allocations) {
      if (b.settlementStatus === "win") {
        const back = a.quantity * (b.payoutMultiplier + 1);
        returnedById[a.denominationId] = (returnedById[a.denominationId] ?? 0) + back;
        returnedChips += back;
        returnedValue += back * a.denominationValue;
      } else if (b.settlementStatus === "loss") {
        lostById[a.denominationId] = (lostById[a.denominationId] ?? 0) + a.quantity;
        lostChips += a.quantity;
        lostValue += a.quantity * a.denominationValue;
      }
    }
  }
  const estimated = inventory.map((d) => ({
    ...d,
    availableCount: d.availableCount + (returnedById[d.id] ?? 0),
    allocatedCount: 0,
  }));
  return { estimated, lostById, returnedById, lostChips, lostValue, returnedChips, returnedValue };
}

export function holdingsTotals(inv: { value: number; availableCount: number }[]) {
  let chips = 0;
  let value = 0;
  for (const d of inv) {
    chips += d.availableCount;
    value += d.availableCount * d.value;
  }
  return { chips, value };
}
