"use client";

import { useState } from "react";
import { inventoryTotals } from "@/lib/roulette/inventory";
import { sessionBalance, totalAdded } from "@/lib/roulette/session";
import { useStore } from "@/lib/state/store";
import { ChipsEditor } from "./ChipsEditor";
import { Alert, Button, Card, Field, MoneyInput, Sheet, plural, useFmt } from "./ui";

/** Money and chips at a glance, kept separate so nothing is counted twice. */
export function SessionBar() {
  const session = useStore((s) => s.session);
  const rounds = useStore((s) => s.rounds);
  const fmt = useFmt();
  const [panel, setPanel] = useState<null | "money" | "chips">(null);
  if (!session) return null;
  const t = inventoryTotals(session.inventory);

  return (
    <>
      <Card className="space-y-3">
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
      </Card>

      <AddMoneySheet open={panel === "money"} onClose={() => setPanel(null)} />
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
