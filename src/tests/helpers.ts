import { addChipType, chipsDone, createSession } from "@/lib/roulette/session";
import type { BetPosition, Session } from "@/lib/roulette/types";

/** Amounts in minor units: Rs. 100 = 10000. */
export const rs = (n: number) => n * 100;

/** A ready-to-play session: chips 100×10, 500×10, 1000×5; money Rs. 20,000. */
export function makeSession(
  chips: { value: number; count: number }[] = [
    { value: rs(100), count: 10 },
    { value: rs(500), count: 10 },
    { value: rs(1000), count: 5 },
  ],
): Session {
  let s = createSession("LKR", rs(20000));
  for (const c of chips) s = addChipType(s, c.value, c.count).session;
  return chipsDone(s);
}

export function betKeys(bets: BetPosition[]): string[] {
  return bets.map((b) => b.key);
}
