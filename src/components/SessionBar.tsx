"use client";

import { useState } from "react";
import { inventoryTotals } from "@/lib/roulette/inventory";
import { sessionBalance, totalAdded } from "@/lib/roulette/session";
import { useStore } from "@/lib/state/store";
import { ChipsEditor } from "./ChipsEditor";
import { SyncBadge } from "./CloudCard";
import { Alert, Button, Card, Field, MoneyInput, Sheet, plural, useFmt } from "./ui";

/** Money and chips at a glance, kept separate so nothing is counted twice. */
export function SessionBar() {
  const session = useStore((s) => s.session);
  const rounds = useStore((s) => s.rounds);
  const fmt = useFmt();
  const [panel, setPanel] = useState<null | "money" | "chips" | "limits">(null);
  if (!session) return null;
  const t = inventoryTotals(session.inventory);

  return (
    <>
      <Card className="space-y-3">
        <SyncBadge />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-base text-muted">Money to Play</div>
            <div className="tabular text-2xl font-bold">{fmt(sessionBalance(session, rounds))}</div>
          </div>
          <div>
            <div className="text-base text-muted">My Chips</div>
            <div className="tabular text-2xl font-bold">{plural(t.totalChips, "chip")}</div>
            <div className="tabular text-base text-muted">{fmt(t.totalValue)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setPanel("money")}>Add More Money</Button>
          <Button onClick={() => setPanel("chips")}>Change My Chips</Button>
        </div>
        <button className="min-h-[44px] w-full text-base text-muted underline" onClick={() => setPanel("limits")}>
          {limitsText(session, fmt)}
        </button>
      </Card>

      <AddMoneySheet open={panel === "money"} onClose={() => setPanel(null)} />
      <LimitsSheet open={panel === "limits"} onClose={() => setPanel(null)} />
      <Sheet open={panel === "chips"} onClose={() => setPanel(null)} title="My Chips">
        <ChipsEditor />
      </Sheet>
    </>
  );
}

function AddMoneySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useStore((s) => s.session);
  const addMoney = useStore((s) => s.addMoney);
  const fmt = useFmt();
  const [amount, setAmount] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  if (!session) return null;
  return (
    <Sheet
      open={open}
      onClose={() => {
        setSure(false);
        setAmount(null);
        onClose();
      }}
      title="Add More Money"
    >
      <div className="space-y-4">
        <p className="text-lg text-muted">
          Money started with: {fmt(session.startingMoney)}
          {totalAdded(session) > 0 ? ` · added so far: ${fmt(totalAdded(session))}` : ""}
        </p>
        {!sure ? (
          <>
            <Field label="How much money do you want to add?">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
            <Button variant="primary" className="w-full" disabled={!amount} onClick={() => setSure(true)}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Alert tone="info">Add {fmt(amount ?? 0)} to your money? This does not add chips. Add your new chips under My Chips.</Alert>
            <Button
              variant="primary"
              className="w-full"
              onClick={async () => {
                if (amount && (await addMoney(amount))) {
                  setSure(false);
                  setAmount(null);
                  onClose();
                }
              }}
            >
              Yes, Add {fmt(amount ?? 0)}
            </Button>
            <Button className="w-full" onClick={() => setSure(false)}>
              No, Go Back
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

const limitsText = (s: { stopWin?: number | null; stopLoss?: number | null }, fmt: (n: number) => string) =>
  s.stopWin || s.stopLoss
    ? `Stop limits: ${[s.stopWin ? `win ${fmt(s.stopWin)}` : null, s.stopLoss ? `loss ${fmt(s.stopLoss)}` : null].filter(Boolean).join(" · ")}`
    : "Set stop limits (optional)";

/** Optional reminders: a calm message when total profit or loss reaches the amount the player chose. Nothing is blocked. */
function LimitsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useStore((s) => s.session);
  const setLimits = useStore((s) => s.setLimits);
  const [win, setWin] = useState<number | null>(null);
  const [loss, setLoss] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  // start from what is saved each time the sheet opens
  if (open !== shown) {
    setShown(open);
    if (open) {
      setWin(session?.stopWin ?? null);
      setLoss(session?.stopLoss ?? null);
    }
  }
  if (!session) return null;
  return (
    <Sheet open={open} onClose={onClose} title="Stop Limits">
      <div className="space-y-4">
        <p className="text-lg text-muted">Choose an amount to be reminded at. The app only shows a message. It never stops you from playing. Leave a box empty for no limit.</p>
        <Field label="Remind me when I am up by">{(id) => <MoneyInput id={id} value={win} onChange={setWin} placeholder="No limit" />}</Field>
        <Field label="Remind me when I am down by">{(id) => <MoneyInput id={id} value={loss} onChange={setLoss} placeholder="No limit" />}</Field>
        <Button
          variant="primary"
          className="w-full"
          onClick={async () => {
            if (await setLimits(win && win > 0 ? win : null, loss && loss > 0 ? loss : null)) onClose();
          }}
        >
          Save Limits
        </Button>
        {(session.stopWin || session.stopLoss) && (
          <Button
            className="w-full"
            onClick={async () => {
              if (await setLimits(null, null)) onClose();
            }}
          >
            Remove Limits
          </Button>
        )}
      </div>
    </Sheet>
  );
}
