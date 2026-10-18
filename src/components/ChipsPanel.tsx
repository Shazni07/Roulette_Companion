"use client";

import { useState } from "react";
import { suggestChipCount } from "@/lib/roulette/inventory";
import { Alert, Button, Card, ConfirmDialog, Field, IntInput, MoneyInput, QtyStepper, Row, plural } from "./ui";

export interface ChipRow {
  id: string;
  value: number; // minor units
  /** chips that can still be placed */
  count: number;
  /** chips currently on bets */
  onBets: number;
}

type Result = boolean | Promise<boolean>;

/**
 * Chips the player holds: add a chip type, change quantities, edit a value, remove.
 * Purely presentational – the start page (draft in memory) and the "Change My
 * Chips" popup (saved session) both use it.
 */
export function ChipsPanel({
  rows,
  moneyLeft,
  fmt,
  onAdd,
  onBump,
  onSetValue,
  onRemove,
  error,
}: {
  rows: ChipRow[];
  /** money that has not been turned into chips yet */
  moneyLeft: number;
  fmt: (minor: number) => string;
  onAdd: (value: number, count: number) => Result;
  onBump: (id: string, delta: number) => void;
  onSetValue: (id: string, value: number) => Result;
  onRemove: (id: string) => void;
  error?: string | null;
}) {
  const [value, setValue] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  /** until the player types their own number, the count follows the money left */
  const [countEdited, setCountEdited] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: number | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const totalChips = rows.reduce((s, r) => s + r.count + r.onBets, 0);
  const totalValue = rows.reduce((s, r) => s + r.value * (r.count + r.onBets), 0);
  const onBetsTotal = rows.reduce((s, r) => s + r.onBets, 0);

  const suggested = value !== null && value > 0 ? suggestChipCount(moneyLeft, value) : null;
  const shownCount = countEdited ? count : suggested;
  const canAdd = value !== null && value > 0 && shownCount !== null;
  const removeTarget = rows.find((r) => r.id === removing);

  return (
    <div className="space-y-4">
      <Card>
        <Row label="Total Chips" value={totalChips} strong />
        <Row label="Total Chip Value" value={fmt(totalValue)} strong />
        <Row label="Money Not Yet in Chips" value={fmt(moneyLeft)} />
        {onBetsTotal > 0 && (
          <p className="text-base text-muted">
            {plural(onBetsTotal, "chip")} {onBetsTotal === 1 ? "is" : "are"} on bets right now.
          </p>
        )}
      </Card>

      {rows.map((d) => (
        <Card key={d.id}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xl font-bold">{fmt(d.value)} chips</h3>
            <span className="tabular text-lg text-muted">= {fmt(d.value * (d.count + d.onBets))}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg">How many</span>
            <QtyStepper label={`${fmt(d.value)} chips`} value={d.count} onChange={(n) => onBump(d.id, n - d.count)} />
          </div>
          {d.onBets > 0 && <p className="mt-1 text-base text-muted">Plus {d.onBets} on bets.</p>}
          {editing?.id === d.id ? (
            <div className="mt-3 space-y-2">
              <Field label="New chip value">{(id) => <MoneyInput id={id} value={editing.value} onChange={(v) => setEditing({ id: d.id, value: v })} />}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={editing.value === null || editing.value <= 0}
                  onClick={async () => {
                    if (await onSetValue(d.id, editing.value!)) setEditing(null);
                  }}
                >
                  Save Value
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button onClick={() => setEditing({ id: d.id, value: d.value })}>Change Value</Button>
              <Button variant="danger" onClick={() => setRemoving(d.id)}>
                Remove
              </Button>
            </div>
          )}
        </Card>
      ))}

      <Card>
        <h3 className="mb-3 text-xl font-bold">Add a Chip Type</h3>
        <div className="space-y-3">
          <Field label="Chip value" hint="For example 100 or 500">
            {(id) => <MoneyInput id={id} value={value} onChange={setValue} />}
          </Field>
          <Field
            label="How many chips"
            hint={
              suggested !== null
                ? `Money not yet in chips: ${fmt(moneyLeft)}. That is ${plural(suggested, "chip")} of ${fmt(value!)}. You can change the number.`
                : "Type the chip value and we will work out how many chips your money makes."
            }
          >
            {(id) => (
              <IntInput
                id={id}
                value={shownCount}
                onChange={(n) => {
                  setCount(n);
                  setCountEdited(true);
                }}
              />
            )}
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button
            variant="primary"
            className="w-full"
            disabled={!canAdd}
            onClick={async () => {
              if (await onAdd(value!, shownCount!)) {
                setValue(null);
                setCount(null);
                setCountEdited(false);
              }
            }}
          >
            Add This Chip
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this chip?"
        danger
        confirmLabel="Yes, Remove"
        body={<p>{removeTarget ? `Remove all ${removeTarget.count} chips of ${fmt(removeTarget.value)} from your list?` : ""}</p>}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onRemove(removing);
          setRemoving(null);
        }}
      />
    </div>
  );
}
