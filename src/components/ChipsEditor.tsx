"use client";

import { inventoryTotals } from "@/lib/roulette/inventory";
import { sessionBalance } from "@/lib/roulette/session";
import { useStore } from "@/lib/state/store";
import { ChipsPanel } from "./ChipsPanel";
import { useFmt } from "./ui";

/** "Change My Chips" during a session: the chips are saved with the session. */
export function ChipsEditor() {
  const session = useStore((s) => s.session);
  const rounds = useStore((s) => s.rounds);
  const { addChip, bumpChip, editChip, removeChip } = useStore();
  const fmt = useFmt();
  if (!session) return null;

  const t = inventoryTotals(session.inventory);
  // money that has not been turned into chips yet = money to play − value of the chips already entered
  const moneyLeft = Math.max(0, sessionBalance(session, rounds) - t.totalValue);

  return (
    <ChipsPanel
      rows={session.inventory.map((d) => ({ id: d.id, value: d.value, count: d.availableCount, onBets: d.allocatedCount }))}
      moneyLeft={moneyLeft}
      fmt={fmt}
      onAdd={(value, count) => addChip(value, count)}
      onBump={(id, delta) => void bumpChip(id, delta)}
      onSetValue={(id, value) => editChip(id, { value })}
      onRemove={(id) => void removeChip(id)}
    />
  );
}
