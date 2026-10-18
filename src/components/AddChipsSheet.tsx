"use client";

import { useState } from "react";
import { BULK_TYPES, emptyBulkExtra, type BulkExtra, type BulkType } from "@/lib/roulette/betting";
import type { BetPosition } from "@/lib/roulette/types";
import { useStore } from "@/lib/state/store";
import { Alert, Button, QtyStepper, Sheet, plural, useFmt } from "./ui";

const LABEL: Record<BulkType, string> = {
  straight: "Straights",
  split: "Splits",
  corner: "Corners",
  street: "Streets",
  sixLine: "Double Streets",
};

/**
 * "Last round + more": pick how many extra chips (0 or more) every bet of each
 * type gets on top of last round's chips, then apply to all of them at once.
 */
/** `lastRound` holds, for each type, the bets placed last round that this button can raise (with their chips). */
export function AddChipsSheet({ open, onClose, lastRound }: { open: boolean; onClose: () => void; lastRound: Record<BulkType, BetPosition[]> }) {
  const session = useStore((s) => s.session);
  const applyPreviousPlus = useStore((s) => s.applyPreviousPlus);
  const fmt = useFmt();
  const [extra, setExtra] = useState<BulkExtra>(emptyBulkExtra());
  const [denId, setDenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const dens = [...session.inventory].sort((a, b) => a.value - b.value);
  const chosen = dens.find((d) => d.id === denId) ?? dens[0];
  const betCount = (t: BulkType) => lastRound[t].length;
  const chipCount = (t: BulkType) => lastRound[t].reduce((s, b) => s + b.chipCount, 0);
  const extraChips = BULK_TYPES.reduce((s, t) => s + extra[t] * betCount(t), 0);
  const totalBets = BULK_TYPES.reduce((s, t) => s + betCount(t), 0);
  const totalLastChips = BULK_TYPES.reduce((s, t) => s + chipCount(t), 0);

  return (
    <Sheet open={open} onClose={onClose} title="Add Chips">
      <div className="space-y-4">
        <p className="text-lg text-muted">
          Every bet you placed last round is set to <b className="text-fg">last round&apos;s chips plus the extra chips</b> you choose below. Use 0 to keep a type the same.
        </p>

        <div>
          <div className="mb-2 text-lg font-semibold">Chip value to add</div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Chip value to add">
            {dens.map((d) => (
              <button
                key={d.id}
                role="radio"
                aria-checked={chosen?.id === d.id}
                onClick={() => setDenId(d.id)}
                className={`min-h-[56px] rounded-2xl border-2 px-1 text-lg font-bold ${chosen?.id === d.id ? "border-gain bg-gain/10 text-gain" : "border-line bg-surface2"}`}
              >
                {fmt(d.value)}
              </button>
            ))}
          </div>
        </div>

        <ul className="space-y-3">
          {BULK_TYPES.map((t) => (
            <li key={t} className="rounded-2xl border border-line bg-surface2/60 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="text-xl font-bold">{LABEL[t]}</span>
                <span className="text-right text-base text-muted">
                  {betCount(t) > 0 ? (
                    <>
                      {plural(betCount(t), "bet")} · <b className="text-fg">{plural(chipCount(t), "chip")}</b> last round
                    </>
                  ) : (
                    "none last round"
                  )}
                </span>
              </div>
              {betCount(t) > 0 && (
                <details className="mb-2 rounded-xl bg-surface px-3 py-1 text-base">
                  <summary className="min-h-[44px] cursor-pointer py-2 font-semibold">See the chips on each bet</summary>
                  <ul className="space-y-1 pb-2">
                    {lastRound[t].map((b) => (
                      <li key={b.id} className="tabular flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{b.label.replace(/^[^:]+: /, "")}</span>
                        <span className="text-right text-muted">
                          {b.allocations.map((a) => `${a.quantity} × ${fmt(a.denominationValue)}`).join(" + ")} · <b className="text-fg">{plural(b.chipCount, "chip")}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg">Extra chips</span>
                <QtyStepper label={`extra chips on ${LABEL[t]}`} value={extra[t]} onChange={(n) => setExtra({ ...extra, [t]: n })} />
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-xl bg-surface2 p-3 text-lg">
          {chosen && extraChips > 0
            ? `${plural(extraChips, "extra chip")} of ${fmt(chosen.value)} (${fmt(extraChips * chosen.value)}) will be added across ${plural(totalBets, "bet")}.`
            : `The ${plural(totalBets, "bet")} (${plural(totalLastChips, "chip")}) from last round get the same chips as last round.`}
        </div>
        <Alert tone="info">Chips that are on these bets now are replaced. Bets you did not place last round are not touched: add those yourself.</Alert>

        <Button
          variant="primary"
          className="w-full"
          disabled={!chosen || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await applyPreviousPlus(extra, chosen!.id);
            setBusy(false);
            if (ok) onClose();
          }}
        >
          Apply to {plural(totalBets, "bet")}
        </Button>
      </div>
    </Sheet>
  );
}
